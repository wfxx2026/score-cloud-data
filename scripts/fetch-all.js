#!/usr/bin/env node
/**
 * 每日分数抓取脚本 - 支持自动获取用户列表
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { existsSync, mkdirSync } = require('fs');

// ==================== 配置 ====================
const CONFIG = {
    apiBaseUrl: process.env.API_BASE_URL || '',
    personId: process.env.API_PERSON_ID || '',
    cookie: process.env.API_COOKIE || '',
    delay: parseInt(process.env.FETCH_DELAY) || 800,
    pageSize: 100,
    maxPage: 10,
    dailyLimit: 45,
    maxRetries: 3,
    targetDate: process.env.TARGET_DATE || new Date().toISOString().split('T')[0],
    forceUpdate: process.env.FORCE_UPDATE === 'true',
    dataDir: process.env.DATA_DIR || 'data',
    summaryDir: process.env.SUMMARY_DIR || 'daily-summary',
    reportDir: process.env.REPORT_DIR || 'reports',
    // 新增：自动发现用户配置
    autoDiscover: process.env.AUTO_DISCOVER !== 'false', // 默认开启
    discoverPageSize: 500, // 每次获取用户数
    maxDiscoverPages: 20 // 最大发现页数
};

// ==================== 工具函数 ====================
function Esdt(code) {
    if (!code) return '';
    let c = '', l = [];
    for (let i = 0; i < code.length; i++) {
        let temp = code.charCodeAt(i);
        l.push(temp.toString().length);
        c += temp;
    }
    return encodeURIComponent(c + '^' + l.join(','));
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function formatDate(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// ==================== API 客户端 ====================
class ScoreAPI {
    constructor(config) {
        this.baseURL = config.apiBaseUrl;
        this.personId = config.personId;
        this.cookie = config.cookie;
        this.delay = config.delay;
    }

    async request(endpoint, data, retryCount = 0) {
        const url = `${this.baseURL}${endpoint}`;
        
        try {
            const response = await axios.post(url, data, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': this.cookie,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                timeout: 15000,
                validateStatus: status => status < 500
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}`);
            }

            return response.data;
        } catch (error) {
            if (retryCount < CONFIG.maxRetries) {
                log('warn', `请求失败，${retryCount + 1}/${CONFIG.maxRetries} 重试: ${error.message}`);
                await sleep(1000 * (retryCount + 1));
                return this.request(endpoint, data, retryCount + 1);
            }
            throw error;
        }
    }

    // 查询用户分数
    async queryType(userName, type, begin, end) {
        let page = 1;
        
        while (page <= CONFIG.maxPage) {
            const data = {
                pid: Esdt(this.personId),
                page: page,
                rows: CONFIG.pageSize,
                begin: Esdt(begin),
                end: Esdt(end),
                type: type
            };

            const res = await this.request('/ArchiveManger/D_PersonAccumulate/GetAccumulateRankingListOne', data);
            
            if (!res || !Array.isArray(res.data)) {
                return 0;
            }

            // 模糊匹配用户
            const user = res.data.find(u => {
                if (!u.PersonName) return false;
                const n1 = userName.toLowerCase().replace(/\s/g, '');
                const n2 = u.PersonName.toLowerCase().replace(/\s/g, '');
                return n1 === n2 || n1.includes(n2) || n2.includes(n1) ||
                       (n1.length > 2 && n2.length > 2 && 
                        (n1.includes(n2.substring(0, 2)) || n2.includes(n1.substring(0, 2))));
            });

            if (user) {
                log('debug', `找到用户 ${userName}: ${user.AllCount}分`);
                return user.AllCount || 0;
            }

            if (res.data.length < CONFIG.pageSize) break;
            
            page++;
            await sleep(100);
        }

        return 0;
    }

    async queryUser(userName, begin, end) {
        let score = await this.queryType(userName, 1, begin, end);
        if (score > 0) return score;
        return await this.queryType(userName, 0, begin, end);
    }

    // ==================== 新增：自动发现所有用户 ====================
    
    /**
     * 从排名列表获取所有用户
     */
    async discoverAllUsers(date) {
        log('info', '开始自动发现用户列表...');
        const users = new Map(); // 使用 Map 去重
        
        // 尝试两种类型：1=单位，0=集团
        for (const type of [1, 0]) {
            let page = 1;
            let emptyCount = 0;
            
            while (page <= CONFIG.maxDiscoverPages && emptyCount < 3) {
                try {
                    const data = {
                        pid: Esdt(this.personId),
                        page: page,
                        rows: CONFIG.discoverPageSize,
                        begin: Esdt(date),
                        end: Esdt(date),
                        type: type
                    };

                    log('info', `获取排名列表: type=${type}, page=${page}`);
                    const res = await this.request('/ArchiveManger/D_PersonAccumulate/GetAccumulateRankingListOne', data);
                    
                    if (!res || !Array.isArray(res.data) || res.data.length === 0) {
                        emptyCount++;
                        if (emptyCount >= 3) {
                            log('info', `类型${type}连续3页无数据，停止获取`);
                            break;
                        }
                    } else {
                        emptyCount = 0;
                        
                        // 提取用户信息
                        for (const item of res.data) {
                            if (item.PersonName && item.PersonId) {
                                users.set(item.PersonName, {
                                    name: item.PersonName,
                                    personId: item.PersonId,
                                    dept: item.DepartmentName || '',
                                    score: item.AllCount || 0
                                });
                            }
                        }
                        
                        log('info', `类型${type}第${page}页: 获取${res.data.length}人，累计${users.size}人`);
                    }
                    
                    // 如果返回数据少于请求数，说明已到末尾
                    if (res.data.length < CONFIG.discoverPageSize) {
                        log('info', `类型${type}数据获取完毕`);
                        break;
                    }
                    
                    page++;
                    await sleep(300); // 避免请求过快
                    
                } catch (error) {
                    log('error', `获取第${page}页失败: ${error.message}`);
                    break;
                }
            }
        }
        
        const userList = Array.from(users.values());
        log('info', `用户发现完成，共找到 ${userList.length} 个唯一用户`);
        return userList;
    }

    /**
     * 获取用户详细信息（备用接口）
     */
    async getUserDetail(personId) {
        try {
            const data = {
                pid: Esdt(personId)
            };
            const res = await this.request('/ArchiveManger/D_PersonAccumulate/GetPersonDetail', data);
            return res;
        } catch (e) {
            return null;
        }
    }
}

// ==================== 数据管理 ====================
class DataManager {
    constructor() {
        this.dirs = {
            data: CONFIG.dataDir,
            summary: CONFIG.summaryDir,
            report: CONFIG.reportDir
        };
    }

    async init() {
        Object.values(this.dirs).forEach(dir => {
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
        });
    }

    async getUserList() {
        const users = new Set();
        
        // 1. 从现有数据文件读取
        try {
            const files = await fs.readdir(this.dirs.data);
            for (const file of files) {
                if (file.endsWith('.json') && file !== 'latest.json' && file !== 'placeholder.json') {
                    const content = JSON.parse(
                        await fs.readFile(path.join(this.dirs.data, file), 'utf8')
                    );
                    Object.values(content).forEach(user => {
                        if (user.userName) users.add(user.userName);
                    });
                }
            }
        } catch (e) {
            log('warn', `读取数据目录失败: ${e.message}`);
        }

        // 2. 从环境变量读取
        if (process.env.EXTRA_USERS) {
            process.env.EXTRA_USERS.split(',').forEach(u => {
                users.add(u.trim());
            });
        }

        // 3. 从用户列表文件读取
        try {
            const listContent = await fs.readFile('user-list.txt', 'utf8');
            listContent.split('\n').forEach(line => {
                const name = line.trim();
                if (name && !name.startsWith('#')) users.add(name);
            });
        } catch (e) {
            // 文件不存在则忽略
        }

        return Array.from(users);
    }

    // 保存发现的完整用户列表
    async saveDiscoveredUsers(users) {
        const filePath = 'discovered-users.json';
        const data = {
            discoveredAt: new Date().toISOString(),
            count: users.length,
            users: users
        };
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        log('info', `已保存用户列表到 ${filePath}`);
    }

    async checkExisting(date) {
        const summaryFile = path.join(this.dirs.summary, `${date}.json`);
        try {
            const stats = await fs.stat(summaryFile);
            const age = Date.now() - stats.mtime.getTime();
            return {
                exists: true,
                age: Math.floor(age / 1000 / 60),
                path: summaryFile
            };
        } catch {
            return { exists: false };
        }
    }

    async saveSummary(date, data) {
        const filePath = path.join(this.dirs.summary, `${date}.json`);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        log('info', `汇总已保存: ${filePath}`);
        return filePath;
    }

    async updateMonthlyData(date, results) {
        const yearMonth = date.substring(0, 7);
        const filePath = path.join(this.dirs.data, `${yearMonth}.json`);
        
        let monthlyData = {};
        try {
            const content = await fs.readFile(filePath, 'utf8');
            monthlyData = JSON.parse(content);
        } catch (e) {
            log('info', `创建新的月度数据文件: ${filePath}`);
        }

        Object.entries(results).forEach(([name, data]) => {
            const userId = `auto_${name}`;
            
            if (!monthlyData[userId]) {
                monthlyData[userId] = {
                    userName: name,
                    userIndex: Object.keys(monthlyData).length + 1,
                    deviceId: 'github-actions',
                    dailyScores: {},
                    monthlyTotal: 0,
                    exceedDays: 0,
                    firstSeen: new Date().toISOString(),
                    lastUpdate: new Date().toISOString()
                };
            }

            monthlyData[userId].dailyScores[date] = data.score;
            monthlyData[userId].lastUpdate = new Date().toISOString();

            const scores = Object.values(monthlyData[userId].dailyScores);
            monthlyData[userId].monthlyTotal = scores.reduce((a, b) => a + b, 0);
            monthlyData[userId].exceedDays = scores.filter(s => s > CONFIG.dailyLimit).length;
        });

        await fs.writeFile(filePath, JSON.stringify(monthlyData, null, 2));
        log('info', `月度数据已更新: ${filePath}`);
        
        return Object.keys(monthlyData).length;
    }
}

// ==================== 主程序 ====================
async function main() {
    log('info', '========================================');
    log('info', '每日分数抓取任务启动');
    log('info', `目标日期: ${CONFIG.targetDate}`);
    log('info', `自动发现用户: ${CONFIG.autoDiscover}`);
    log('info', '========================================');

    // 验证配置
    if (!CONFIG.apiBaseUrl || !CONFIG.personId || !CONFIG.cookie) {
        log('error', '缺少必要配置: API_BASE_URL, API_PERSON_ID, API_COOKIE');
        process.exit(1);
    }

    // 初始化
    const dm = new DataManager();
    await dm.init();

    // 检查是否已存在
    if (!CONFIG.forceUpdate) {
        const existing = await dm.checkExisting(CONFIG.targetDate);
        if (existing.exists) {
            log('warn', `数据已存在 (${existing.age}分钟前): ${existing.path}`);
            log('info', '使用 FORCE_UPDATE=true 强制更新');
            process.exit(0);
        }
    }

    // 创建API客户端
    const api = new ScoreAPI(CONFIG);

    // ==================== 获取用户列表 ====================
    let users = [];
    let discoveredUsers = [];

    // 方式1：自动发现所有用户（如果开启）
    if (CONFIG.autoDiscover) {
        try {
            discoveredUsers = await api.discoverAllUsers(CONFIG.targetDate);
            if (discoveredUsers.length > 0) {
                // 保存发现的完整用户列表
                await dm.saveDiscoveredUsers(discoveredUsers);
                // 只提取姓名用于查询
                users = discoveredUsers.map(u => u.name);
                log('info', `通过API发现 ${users.length} 个用户`);
            }
        } catch (e) {
            log('error', `自动发现用户失败: ${e.message}`);
        }
    }

    // 方式2：如果自动发现失败或关闭，使用本地列表
    if (users.length === 0) {
        users = await dm.getUserList();
        log('info', `从本地获取 ${users.length} 个用户`);
    }

    // 合并去重
    users = [...new Set(users)];
    log('info', `最终用户列表: ${users.length} 人`);

    if (users.length === 0) {
        log('error', '用户列表为空，请先添加用户或开启自动发现');
        process.exit(1);
    }

    // ==================== 抓取数据 ====================
    const results = {};
    let successCount = 0;
    let failCount = 0;
    let exceedCount = 0;

    for (let i = 0; i < users.length; i++) {
        const name = users[i];
        log('info', `[${i + 1}/${users.length}] 查询: ${name}`);

        try {
            const score = await api.queryUser(name, CONFIG.targetDate, CONFIG.targetDate);
            const isExceed = score > CONFIG.dailyLimit;
            
            results[name] = {
                score,
                isExceed,
                queryTime: new Date().toISOString()
            };

            if (isExceed) exceedCount++;
            successCount++;

            await sleep(CONFIG.delay);
        } catch (error) {
            log('error', `查询失败 ${name}: ${error.message}`);
            results[name] = {
                score: 0,
                isExceed: false,
                error: true,
                errorMsg: error.message
            };
            failCount++;
            
            await sleep(CONFIG.delay * 2);
        }
    }

    // ==================== 保存结果 ====================
    const summary = {
        date: CONFIG.targetDate,
        generatedAt: new Date().toISOString(),
        totalUsers: users.length,
        successCount,
        failCount,
        exceedCount,
        normalCount: successCount - exceedCount,
        users: results,
        meta: {
            source: 'github-actions',
            version: '2.1',
            autoDiscover: CONFIG.autoDiscover,
            discoveredCount: discoveredUsers.length,
            apiBase: CONFIG.apiBaseUrl.replace(/\/\/.*@/, '//***@')
        }
    };

    await dm.saveSummary(CONFIG.targetDate, summary);
    const totalUsers = await dm.updateMonthlyData(CONFIG.targetDate, results);

    // 输出结果
    log('info', '========================================');
    log('info', '抓取完成');
    log('info', `成功抓取: ${successCount}/${users.length}`);
    log('info', `超额人数: ${exceedCount}`);
    log('info', `失败人数: ${failCount}`);
    log('info', `月度总用户: ${totalUsers}`);
    log('info', '========================================');

    // GitHub Actions 输出
    if (process.env.GITHUB_OUTPUT) {
        const output = `
fetch_count=${successCount}
exceed_count=${exceedCount}
fail_count=${failCount}
total_users=${totalUsers}
discovered_count=${discoveredUsers.length}
        `.trim();
        await fs.writeFile(process.env.GITHUB_OUTPUT, output, { flag: 'a' });
    }

    // 失败率过高
    if (failCount > successCount / 2) {
        process.exit(2);
    }
}

main().catch(error => {
    log('error', `未捕获的错误: ${error.message}`);
    console.error(error);
    process.exit(1);
});
