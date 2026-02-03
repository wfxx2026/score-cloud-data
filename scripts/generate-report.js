#!/usr/bin/env node
/**
 * 生成可视化报表
 */

const fs = require('fs');
const path = require('path');

function generateHTML(date, data) {
    const users = Object.values(data.users || {});
    const exceeds = Object.entries(data.users || {})
        .filter(([_, u]) => u.isExceed)
        .sort((a, b) => b[1].score - a[1].score);
    
    const normal = Object.entries(data.users || {})
        .filter(([_, u]) => !u.isExceed && !u.error)
        .sort((a, b) => b[1].score - a[1].score);

    const maxScore = Math.max(...users.map(u => u.score || 0), 1);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>每日分数报表 - ${date}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .exceed-limit {
            background: linear-gradient(135deg, #ff4757 0%, #ff6348 100%) !important;
            color: white !important;
        }
        @keyframes pulse-red {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        .animate-pulse-red {
            animation: pulse-red 2s infinite;
        }
    </style>
</head>
<body class="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4 md:p-8">
    <div class="max-w-6xl mx-auto space-y-6">
        
        <!-- 头部 -->
        <div class="bg-white rounded-2xl shadow-xl p-6">
            <div class="flex justify-between items-center">
                <div>
                    <h1 class="text-3xl font-bold text-gray-800">📊 每日分数报表</h1>
                    <p class="text-gray-600 mt-2">${date} 数据概览</p>
                </div>
                <div class="text-right">
                    <div class="text-sm text-gray-500">生成时间</div>
                    <div class="font-mono">${new Date(data.generatedAt).toLocaleString('zh-CN')}</div>
                </div>
            </div>
        </div>

        <!-- 统计卡片 -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-blue-600">${data.totalUsers || 0}</div>
                <div class="text-gray-500 text-sm">总人数</div>
            </div>
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-green-600">${data.successCount || 0}</div>
                <div class="text-gray-500 text-sm">成功</div>
            </div>
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-red-500">${data.exceedCount || 0}</div>
                <div class="text-gray-500 text-sm">超额</div>
            </div>
            <div class="bg-white rounded-xl p-4 shadow">
                <div class="text-3xl font-bold text-purple-600">${data.normalCount || 0}</div>
                <div class="text-gray-500 text-sm">正常</div>
            </div>
        </div>

        <!-- 图表 -->
        <div class="bg-white rounded-2xl shadow-xl p-6">
            <h3 class="font-bold text-lg mb-4">📈 分数分布 (前20名)</h3>
            <div class="h-64 flex items-end justify-around gap-2 overflow-x-auto pb-2">
                ${users.slice(0, 20).map(u => {
                    const height = ((u.score || 0) / maxScore * 100);
                    return `
                        <div class="flex flex-col items-center gap-1 min-w-[40px]">
                            <div class="text-xs text-gray-500">${u.score || 0}</div>
                            <div class="w-8 rounded-t-lg ${u.isExceed ? 'exceed-limit animate-pulse-red' : 'bg-gradient-to-t from-blue-500 to-purple-500'}" 
                                 style="height: ${Math.max(height, 5)}%"></div>
                            <div class="text-xs text-gray-600 truncate w-full text-center">${Object.entries(data.users).find(([_, user]) => user === u)?.[0]?.substring(0, 2) || ''}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>

        <!-- 详细列表 -->
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div class="p-4 border-b">
                <h3 class="font-bold text-lg">📋 详细数据</h3>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-4 py-3 text-left">排名</th>
                            <th class="px-4 py-3 text-left">姓名</th>
                            <th class="px-4 py-3 text-center">分数</th>
                            <th class="px-4 py-3 text-center">状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${exceeds.map(([name, u], idx) => `
                            <tr class="bg-red-50">
                                <td class="px-4 py-3">${idx + 1}</td>
                                <td class="px-4 py-3 font-semibold">${name}</td>
                                <td class="px-4 py-3 text-center font-bold text-red-600">${u.score}</td>
                                <td class="px-4 py-3 text-center"><span class="px-2 py-1 bg-red-500 text-white rounded text-xs">超额</span></td>
                            </tr>
                        `).join('')}
                        ${normal.map(([name, u], idx) => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3">${exceeds.length + idx + 1}</td>
                                <td class="px-4 py-3">${name}</td>
                                <td class="px-4 py-3 text-center">${u.score}</td>
                                <td class="px-4 py-3 text-center"><span class="px-2 py-1 bg-green-500 text-white rounded text-xs">正常</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- 页脚 -->
        <div class="text-center text-gray-500 text-sm py-4">
            <p>由 GitHub Actions 自动生成</p>
        </div>
    </div>
</body>
</html>`;
}

// 主函数
async function main() {
    const args = process.argv.slice(2);
    let date = new Date().toISOString().split('T')[0];
    let outputDir = 'reports';

    // 解析参数
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--date' && args[i + 1]) {
            date = args[i + 1];
        }
        if (args[i] === '--output' && args[i + 1]) {
            outputDir = args[i + 1];
        }
    }

    // 读取数据
    const summaryPath = path.join('daily-summary', `${date}.json`);
    if (!fs.existsSync(summaryPath)) {
        console.error(`数据文件不存在: ${summaryPath}`);
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

    // 生成HTML
    const html = generateHTML(date, data);
    
    // 确保目录存在
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 保存
    const outputPath = path.join(outputDir, `${date}.html`);
    fs.writeFileSync(outputPath, html);
    
    console.log(`报表已生成: ${outputPath}`);
}

main().catch(console.error);
