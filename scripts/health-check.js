#!/usr/bin/env node
/**
 * 健康检查脚本 - 检查数据更新状态
 */

const https = require('https');
const fs = require('fs');

const CONFIG = {
    owner: process.env.GITHUB_OWNER || 'wfxx2026',
    repo: process.env.GITHUB_REPO || 'score-cloud-data',
    token: process.env.GITHUB_TOKEN || '',
    maxAgeHours: 26,
    alertThreshold: 3
};

function fetchGitHubAPI(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${CONFIG.owner}/${CONFIG.repo}${path}`,
            method: 'GET',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${CONFIG.token}`,
                'User-Agent': 'Health-Check'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON: ' + data));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function checkLatestData() {
    const today = new Date().toISOString().split('T')[0];
    
    try {
        const content = await fetchGitHubAPI(`/contents/daily-summary/${today}.json`);
        console.log(`✅ 今日数据存在: ${today}.json`);
        console.log(`   大小: ${content.size} bytes`);
        return { ok: true, date: today };
    } catch (e) {
        console.log(`❌ 今日数据缺失: ${today}.json`);
        return { ok: false, error: 'Data not found' };
    }
}

async function checkRecentRuns() {
    try {
        const runs = await fetchGitHubAPI('/actions/workflows/daily-score-fetch.yml/runs?per_page=5');
        
        console.log('\n📊 最近工作流运行:');
        
        let failCount = 0;
        
        for (const run of runs.workflow_runs?.slice(0, 3) || []) {
            const status = run.status === 'completed' ? (run.conclusion === 'success' ? '✅' : '❌') : '⏳';
            const date = new Date(run.created_at).toLocaleString('zh-CN');
            console.log(`   ${status} ${date} - ${run.display_title || run.name} (${run.event})`);
            
            if (run.conclusion === 'failure') failCount++;
        }
        
        return { failCount, total: runs.workflow_runs?.length || 0 };
    } catch (e) {
        console.error('检查运行状态失败:', e.message);
        return { failCount: 999, total: 0 };
    }
}

async function main() {
    console.log('========================================');
    console.log('🏥 健康检查报告');
    console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log('========================================\n');
    
    const dataStatus = await checkLatestData();
    const runStatus = await checkRecentRuns();
    
    console.log('\n========================================');
    
    let healthy = true;
    let exitCode = 0;
    
    if (!dataStatus.ok) {
        console.log('❌ 健康状态: 异常 - 今日数据缺失');
        healthy = false;
        exitCode = 1;
    } else if (runStatus.failCount >= CONFIG.alertThreshold) {
        console.log(`❌ 健康状态: 异常 - 连续${runStatus.failCount}次失败`);
        healthy = false;
        exitCode = 2;
    } else {
        console.log('✅ 健康状态: 正常');
    }
    
    console.log('========================================');
    
    process.exit(exitCode);
}

main().catch(e => {
    console.error('健康检查执行失败:', e);
    process.exit(3);
});
