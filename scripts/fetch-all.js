#!/usr/bin/env node
/**
 * 每日分数抓取脚本
 * 支持环境变量或命令行参数
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { existsSync, mkdirSync } = require('fs');

// ==================== 配置 ====================
const CONFIG = {
    // API配置（优先从环境变量读取）
    apiBaseUrl: process.env.API_BASE_URL || '',
    personId: process.env.API_PERSON_ID || '',
    cookie: process.env.API_COOKIE || '',
    
    // 行为配置
    delay: parseInt(process.env.FETCH_DELAY) || 800,
    pageSize: 100,
    maxPage: 10,
    dailyLimit: 45,
    maxRetries: 3,
    
    // 日期配置
    targetDate: process.env.TARGET_DATE || new Date().toISOString().split('T')[0],
    forceUpdate: process.env.FORCE_UPDATE === 'true',
    
    // 路径配置
    dataDir: process.env.DATA_DIR || 'data',
    summaryDir: process.env.SUMMARY_DIR || 'daily-summary',
    reportDir: process.env.REPORT_DIR || 'reports'
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
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    console.log(`${prefix} ${message}`);
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
        // 先查单位(type=1)，再查集团(type=0)
        let score = await this.queryType(userName, 1, begin, end);
        if (score > 0) return score;
        
        score = await this.queryType(userName, 0, begin, end);
        return score;
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
        // 确保目录存在
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
                if (file.endsWith('.json')) {
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

    async checkExisting(date) {
        const summaryFile = path.join(this.dirs.summary, `${date}.json`);
        try {
            const stats = await fs.stat(summaryFile);
            const age = Date.now() - stats.mtime.getTime();
            return {
                exists: true,
                age: Math.floor(age / 1000 / 60), // 分钟
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

        // 更新每个用户的数据
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

            // 重新计算统计
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
    log('info', `强制更新: ${CONFIG.forceUpdate}`);
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

    // 获取用户列表
    const users = await dm.getUserList();
    log('info', `找到 ${users.length} 个用户`);

    if (users.length === 0) {
        log('error', '用户列表为空，请先添加用户');
        process.exit(1);
    }

    // 创建API客户端
    const api = new ScoreAPI(CONFIG);

    // 抓取数据
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

            // 成功延迟
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
            
            // 失败后增加延迟
            await sleep(CONFIG.delay * 2);
        }
    }

    // 生成汇总
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
            version: '2.0',
            apiBase: CONFIG.apiBaseUrl.replace(/\/\/.*@/, '//***@') // 脱敏
        }
    };

    // 保存数据
    await dm.saveSummary(CONFIG.targetDate, summary);
    const totalUsers = await dm.updateMonthlyData(CONFIG.targetDate, results);

    // 输出结果（供GitHub Actions解析）
    log('info', '========================================');
    log('info', '抓取完成');
    log('info', `成功抓取: ${successCount}/${users.length}`);
    log('info', `超额人数: ${exceedCount}`);
    log('info', `失败人数: ${failCount}`);
    log('info', `月度总用户: ${totalUsers}`);
    log('info', '========================================');

    // 设置输出（GitHub Actions）
    if (process.env.GITHUB_OUTPUT) {
        const output = `
fetch_count=${successCount}
exceed_count=${exceedCount}
fail_count=${failCount}
total_users=${totalUsers}
        `.trim();
        await fs.writeFile(process.env.GITHUB_OUTPUT, output, { flag: 'a' });
    }

    // 如果有失败，返回非零退出码
    if (failCount > successCount / 2) {
        process.exit(2); // 大量失败
    }
}

// 运行
main().catch(error => {
    log('error', `未捕获的错误: ${error.message}`);
    console.error(error);
    process.exit(1);
});
