#!/usr/bin/env node
/**
 * 生成可视化报表
 */

const fs = require('fs');
const path = require('path');

function generateHTML(date, data) {
    const exceeds = Object.entries(data.users)
        .filter(([_, u]) => u.isExceed)
        .sort((a, b) => b[1].score - a[1].score);

    const normal = Object.entries(data.users)
        .filter(([_, u]) => !u.isExceed && !u.error)
        .sort((a, b) => b[1].score - a[1].score);

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>每日分数报表 - ${date}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 10px;
        }
        .date {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 15px;
            text-align: center;
        }
        .stat-value {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .stat-label {
            font-size: 14px;
            opacity: 0.9;
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            font-size: 18px;
            color: #333;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #f0f0f0;
        }
        .user-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .user-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-radius: 10px;
            background: #f8f9fa;
        }
        .user-item.exceed {
            background: linear-gradient(135deg, #ff4757 0%, #ff6348 100%);
            color: white;
            animation: pulse 2s infinite;
        }
        .user-item.error {
            background: #ffe0e0;
            color: #c00;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }
        .user-name {
            font-weight: 500;
        }
        .user-score {
            font-size: 20px;
            font-weight: bold;
        }
        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            margin-left: 10px;
        }
        .badge-exceed {
            background: #ffeb3b;
            color: #333;
        }
        .footer {
            text-align: center;
            color: #999;
            font-size: 12px;
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 每日学习分数报表</h1>
        <div class="date">${date} ${new Date(data.generatedAt).toLocaleTimeString('zh-CN')}</div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">${data.totalUsers}</div>
                <div class="stat-label">总人数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.successCount}</div>
                <div class="stat-label">成功</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: #ffeb3b;">${data.exceedCount}</div>
                <div class="stat-label">超额</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.normalCount}</div>
                <div class="stat-label">正常</div>
            </div>
        </div>

        ${exceeds.length > 0 ? `
        <div class="section">
            <div class="section-title">⚠️ 超额人员 (${exceeds.length})</div>
            <div class="user-list">
                ${exceeds.map(([name, u]) => `
                    <div class="user-item exceed">
                        <span class="user-name">${name}</span>
                        <span class="user-score">${u.score}分</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <div class="section">
            <div class="section-title">✅ 正常人员 (${normal.length})</div>
            <div class="user-list">
                ${normal.slice(0, 50).map(([name, u]) => `
                    <div class="user-item">
                        <span class="user-name">${name}</span>
                        <span class="user-score">${u.score}分</span>
                    </div>
                `).join('')}
                ${normal.length > 50 ? `<div style="text-align:center;color:#999;padding:10px;">...还有 ${normal.length - 50} 人</div>` : ''}
            </div>
        </div>

        <div class="footer">
            自动生成于 ${new Date(data.generatedAt).toLocaleString('zh-CN')} | 
            来源: ${data.meta?.source || 'unknown'}
        </div>
    </div>
</body>
</html>`;

    return html;
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
    if (!require('fs').existsSync(summaryPath)) {
        console.error(`数据文件不存在: ${summaryPath}`);
        process.exit(1);
    }

    const data = JSON.parse(require('fs').readFileSync(summaryPath, 'utf8'));

    // 生成HTML
    const html = generateHTML(date, data);
    
    // 确保目录存在
    if (!require('fs').existsSync(outputDir)) {
        require('fs').mkdirSync(outputDir, { recursive: true });
    }

    // 保存
    const outputPath = path.join(outputDir, `${date}.html`);
    require('fs').writeFileSync(outputPath, html);
    
    console.log(`报表已生成: ${outputPath}`);
}

main().catch(console.error);
