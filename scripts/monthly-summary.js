#!/usr/bin/env node
/**
 * 月底自动汇总脚本
 * 合并整月每日数据，生成月度统计报表
 */

const fs = require('fs').promises;
const path = require('path');
const { existsSync, mkdirSync } = require('fs');

const CONFIG = {
    dataDir: process.env.DATA_DIR || 'data',
    summaryDir: process.env.SUMMARY_DIR || 'daily-summary',
    reportDir: process.env.REPORT_DIR || 'reports',
    monthlyDir: process.env.MONTHLY_DIR || 'monthly-reports'
};

function log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

function formatDate(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getMonthDates(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    const dates = [];
    const lastDay = new Date(year, month, 0).getDate();
    
    for (let day = 1; day <= lastDay; day++) {
        dates.push(`${yearMonth}-${String(day).padStart(2, '0')}`);
    }
    return dates;
}

async function loadDailySummaries(yearMonth) {
    const dates = getMonthDates(yearMonth);
    const summaries = {};
    let loadedCount = 0;
    
    for (const date of dates) {
        const filePath = path.join(CONFIG.summaryDir, `${date}.json`);
        try {
            const content = await fs.readFile(filePath, 'utf8');
            summaries[date] = JSON.parse(content);
            loadedCount++;
            log('info', `加载 ${date} 数据: ${summaries[date].totalUsers} 人`);
        } catch (e) {
            // 文件不存在则跳过
            log('debug', `${date} 无数据`);
        }
    }
    
    log('info', `共加载 ${loadedCount} 天数据`);
    return summaries;
}

function mergeMonthlyData(yearMonth, dailySummaries) {
    const userStats = {};
    const dates = Object.keys(dailySummaries).sort();
    
    // 遍历每一天
    for (const [date, summary] of Object.entries(dailySummaries)) {
        for (const [userName, data] of Object.entries(summary.users || {})) {
            if (!userStats[userName]) {
                userStats[userName] = {
                    userName: userName,
                    dailyScores: {},
                    totalDays: 0,
                    totalScore: 0,
                    avgScore: 0,
                    exceedDays: 0,
                    maxScore: 0,
                    minScore: 999,
                    firstDate: date,
                    lastDate: date
                };
            }
            
            const user = userStats[userName];
            user.dailyScores[date] = data.score || 0;
            user.totalDays++;
            user.totalScore += data.score || 0;
            
            if (data.score > 45) user.exceedDays++;
            if (data.score > user.maxScore) user.maxScore = data.score;
            if (data.score < user.minScore) user.minScore = data.score;
            if (date > user.lastDate) user.lastDate = date;
        }
    }
    
    // 计算平均值
    for (const user of Object.values(userStats)) {
        user.avgScore = Math.round(user.totalScore / user.totalDays * 10) / 10;
        if (user.minScore === 999) user.minScore = 0;
    }
    
    // 排序：按总分降序
    const sortedUsers = Object.values(userStats).sort((a, b) => b.totalScore - a.totalScore);
    
    // 添加排名
    sortedUsers.forEach((user, index) => {
        user.rank = index + 1;
    });
    
    return {
        yearMonth: yearMonth,
        generatedAt: new Date().toISOString(),
        totalDays: dates.length,
        dataDays: Object.keys(dailySummaries).length,
        totalUsers: sortedUsers.length,
        statistics: {
            avgTotalScore: Math.round(sortedUsers.reduce((sum, u) => sum + u.totalScore, 0) / sortedUsers.length * 10) / 10,
            avgDailyScore: Math.round(sortedUsers.reduce((sum, u) => sum + u.avgScore, 0) / sortedUsers.length * 10) / 10,
            totalExceedDays: sortedUsers.reduce((sum, u) => sum + u.exceedDays, 0),
            perfectUsers: sortedUsers.filter(u => u.exceedDays === 0).length,
            highRiskUsers: sortedUsers.filter(u => u.exceedDays >= 5).length
        },
        users: sortedUsers,
        dailyAvailability: dates.map(d => ({
            date: d,
            hasData: dailySummaries[d] ? true : false,
            userCount: dailySummaries[d]?.totalUsers || 0
        }))
    };
}

async function updateMonthlyDataFile(yearMonth, monthlyReport) {
    // 更新/创建月度数据文件
    const dataFilePath = path.join(CONFIG.dataDir, `${yearMonth}.json`);
    let existingData = {};
    
    try {
        const content = await fs.readFile(dataFilePath, 'utf8');
        existingData = JSON.parse(content);
        log('info', `读取现有月度数据: ${Object.keys(existingData).length} 人`);
    } catch (e) {
        log('info', '创建新的月度数据文件');
    }
    
    // 合并数据
    for (const user of monthlyReport.users) {
        const userId = `auto_${user.userName}`;
        
        if (!existingData[userId]) {
            existingData[userId] = {
                userName: user.userName,
                userIndex: user.rank,
                deviceId: 'github-actions',
                firstSeen: user.firstDate,
                dailyScores: {}
            };
        }
        
        // 合并每日分数
        Object.assign(existingData[userId].dailyScores, user.dailyScores);
        existingData[userId].monthlyTotal = user.totalScore;
        existingData[userId].exceedDays = user.exceedDays;
        existingData[userId].lastUpdate = new Date().toISOString();
        existingData[userId].monthlyStats = {
            avgScore: user.avgScore,
            maxScore: user.maxScore,
            minScore: user.minScore,
            totalDays: user.totalDays
        };
    }
    
    await fs.writeFile(dataFilePath, JSON.stringify(existingData, null, 2));
    log('info', `月度数据已保存: ${dataFilePath}`);
    
    return Object.keys(existingData).length;
}

function generateMonthlyHTML(report) {
    const topUsers = report.users.slice(0, 50);
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>月度汇总报表 - ${report.yearMonth}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .exceed-high { background: linear-gradient(135deg, #ff4757 0%, #ff6348 100%); color: white; }
        .exceed-medium { background: #ffa502; color: white; }
        .exceed-low { background: #2ed573; color: white; }
        @keyframes pulse-red { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        .animate-pulse-red { animation: pulse-red 2s infinite; }
    </style>
</head>
<body class="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 p-4 md:p-8">
    <div class="max-w-7xl mx-auto space-y-6">
        
        <!-- 头部 -->
        <div class="bg-white rounded-2xl shadow-xl p-6">
            <h1 class="text-3xl font-bold text-gray-800">📊 ${report.yearMonth} 月度汇总报表</h1>
            <p class="text-gray-600 mt-2">数据天数: ${report.dataDays}/${report.totalDays} 天 | 生成时间: ${new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
        </div>

        <!-- 统计卡片 -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-blue-600">${report.totalUsers}</div>
                <div class="text-gray-500 text-sm">总人数</div>
            </div>
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-green-600">${report.statistics.perfectUsers}</div>
                <div class="text-gray-500 text-sm">全月正常</div>
            </div>
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-red-500">${report.statistics.highRiskUsers}</div>
                <div class="text-gray-500 text-sm">高频超额(≥5天)</div>
            </div>
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-purple-600">${report.statistics.avgTotalScore}</div>
                <div class="text-gray-500 text-sm">人均总分</div>
            </div>
        </div>

        <!-- 数据可用性日历 -->
        <div class="bg-white rounded-2xl shadow-xl p-6">
            <h3 class="font-bold text-lg mb-4">📅 数据覆盖情况</h3>
            <div class="grid grid-cols-7 gap-2">
                ${report.dailyAvailability.map(d => `
                    <div class="text-center p-2 rounded ${d.hasData ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}">
                        <div class="text-xs">${d.date.slice(8)}日</div>
                        <div class="text-xs font-bold">${d.hasData ? '✓' : '-'}</div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- 排行榜 -->
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div class="p-4 border-b">
                <h3 class="font-bold text-lg">🏆 月度排行榜 (Top 50)</h3>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-4 py-3 text-left">排名</th>
                            <th class="px-4 py-3 text-left">姓名</th>
                            <th class="px-4 py-3 text-center">总分</th>
                            <th class="px-4 py-3 text-center">平均分</th>
                            <th class="px-4 py-3 text-center">有效天数</th>
                            <th class="px-4 py-3 text-center">超额天数</th>
                            <th class="px-4 py-3 text-center">最高分</th>
                            <th class="px-4 py-3 text-center">状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topUsers.map((u, i) => {
                            const exceedClass = u.exceedDays >= 5 ? 'exceed-high' : u.exceedDays > 0 ? 'exceed-medium' : 'exceed-low';
                            const statusText = u.exceedDays >= 5 ? '高风险' : u.exceedDays > 0 ? '警告' : '优秀';
                            return `
                                <tr class="hover:bg-gray-50 ${i < 3 ? 'bg-yellow-50' : ''}">
                                    <td class="px-4 py-3 font-bold ${i < 3 ? 'text-yellow-600 text-lg' : 'text-gray-600'}">${u.rank}</td>
                                    <td class="px-4 py-3 font-semibold">${u.userName}</td>
                                    <td class="px-4 py-3 text-center font-bold text-blue-600">${u.totalScore}</td>
                                    <td class="px-4 py-3 text-center">${u.avgScore}</td>
                                    <td class="px-4 py-3 text-center">${u.totalDays}</td>
                                    <td class="px-4 py-3 text-center ${u.exceedDays > 0 ? 'text-red-500 font-bold' : 'text-green-500'}">${u.exceedDays}</td>
                                    <td class="px-4 py-3 text-center ${u.maxScore > 45 ? 'text-red-500' : ''}">${u.maxScore}</td>
                                    <td class="px-4 py-3 text-center"><span class="px-2 py-1 rounded text-xs ${exceedClass}">${statusText}</span></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- 详细数据表格 -->
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div class="p-4 border-b">
                <h3 class="font-bold text-lg">📋 每日分数明细</h3>
            </div>
            <div class="overflow-x-auto" style="max-height: 600px;">
                <table class="w-full text-sm">
                    <thead class="bg-gray-100 sticky top-0">
                        <tr>
                            <th class="px-4 py-3 text-left sticky left-0 bg-gray-100">姓名</th>
                            ${Object.keys(report.users[0]?.dailyScores || {}).sort().map(d => `
                                <th class="px-2 py-3 text-center text-xs">${d.slice(8)}日</th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${report.users.slice(0, 100).map(u => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-2 font-medium sticky left-0 bg-white">${u.userName}</td>
                                ${Object.keys(u.dailyScores).sort().map(d => {
                                    const score = u.dailyScores[d] || 0;
                                    return `<td class="px-2 py-2 text-center ${score > 45 ? 'bg-red-500 text-white font-bold' : score > 0 ? 'bg-gray-50' : 'text-gray-300'}">${score > 0 ? score : '-'}</td>`;
                                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ${report.users.length > 100 ? `<div class="p-4 text-center text-gray-500">...还有 ${report.users.length - 100} 人</div>` : ''}
        </div>

    </div>
</body>
</html>`;
}

async function saveMonthlyReport(report) {
    // 保存JSON
    const jsonPath = path.join(CONFIG.monthlyDir, `${report.yearMonth}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
    log('info', `月度汇总JSON: ${jsonPath}`);
    
    // 保存HTML
    const htmlPath = path.join(CONFIG.monthlyDir, `${report.yearMonth}.html`);
    const html = generateMonthlyHTML(report);
    await fs.writeFile(htmlPath, html);
    log('info', `月度汇总HTML: ${htmlPath}`);
    
    // 保存CSV
    const csvPath = path.join(CONFIG.monthlyDir, `${report.yearMonth}.csv`);
    const csvHeaders = ['排名', '姓名', '总分', '平均分', '有效天数', '超额天数', '最高分', '最低分'];
    const csvRows = report.users.map(u => [
        u.rank, u.userName, u.totalScore, u.avgScore, 
        u.totalDays, u.exceedDays, u.maxScore, u.minScore
    ]);
    const csvContent = [csvHeaders.join(','), ...csvRows.map(r => r.join(','))].join('\n');
    await fs.writeFile(csvPath, '\ufeff' + csvContent);
    log('info', `月度汇总CSV: ${csvPath}`);
    
    return { jsonPath, htmlPath, csvPath };
}

async function main() {
    // 确定目标月份
    let targetMonth = process.env.TARGET_MONTH;
    
    if (!targetMonth) {
        // 默认为上个月（如果今天是1号，则汇总上月；否则汇总本月）
        const now = new Date();
        const day = now.getDate();
        
        if (day === 1) {
            // 每月1号汇总上月
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            targetMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
        } else {
            // 其他时间汇总本月
            targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
    }
    
    log('info', '========================================');
    log('info', '月度汇总任务启动');
    log('info', `目标月份: ${targetMonth}`);
    log('info', '========================================');
    
    // 确保目录存在
    if (!existsSync(CONFIG.monthlyDir)) {
        mkdirSync(CONFIG.monthlyDir, { recursive: true });
    }
    
    // 加载每日数据
    const dailySummaries = await loadDailySummaries(targetMonth);
    
    if (Object.keys(dailySummaries).length === 0) {
        log('error', '没有找到任何每日数据');
        process.exit(1);
    }
    
    // 合并月度数据
    const monthlyReport = mergeMonthlyData(targetMonth, dailySummaries);
    log('info', `汇总完成: ${monthlyReport.totalUsers} 人, ${monthlyReport.dataDays} 天数据`);
    
    // 更新月度数据文件
    const totalUsers = await updateMonthlyDataFile(targetMonth, monthlyReport);
    log('info', `月度数据文件已更新: ${totalUsers} 人`);
    
    // 保存汇总报表
    const paths = await saveMonthlyReport(monthlyReport);
    
    // 输出统计
    log('info', '========================================');
    log('info', '月度汇总完成');
    log('info', `总人数: ${monthlyReport.totalUsers}`);
    log('info', `数据天数: ${monthlyReport.dataDays}/${monthlyReport.totalDays}`);
    log('info', `全月正常: ${monthlyReport.statistics.perfectUsers} 人`);
    log('info', `高频超额: ${monthlyReport.statistics.highRiskUsers} 人`);
    log('info', `人均总分: ${monthlyReport.statistics.avgTotalScore}`);
    log('info', '========================================');
    
    // GitHub Actions 输出
    if (process.env.GITHUB_OUTPUT) {
        const output = `
month=${targetMonth}
total_users=${monthlyReport.totalUsers}
data_days=${monthlyReport.dataDays}
perfect_users=${monthlyReport.statistics.perfectUsers}
high_risk_users=${monthlyReport.statistics.highRiskUsers}
        `.trim();
        await fs.writeFile(process.env.GITHUB_OUTPUT, output, { flag: 'a' });
    }
}

main().catch(error => {
    log('error', `执行失败: ${error.message}`);
    console.error(error);
    process.exit(1);
});
