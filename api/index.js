const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 从环境变量读取配置
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;  // 你的GitHub用户名
const GITHUB_REPO = process.env.GITHUB_REPO;    // 数据仓库名，如 score-cloud-data
const DAILY_LIMIT = 45;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// 获取文件内容
async function getFile(path) {
    try {
        const { data } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: path
        });
        const content = Buffer.from(data.content, 'base64').toString();
        return { content: JSON.parse(content), sha: data.sha };
    } catch (e) {
        if (e.status === 404) return { content: {}, sha: null };
        throw e;
    }
}

// 保存文件
async function saveFile(path, content, sha) {
    const params = {
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: path,
        message: `Update ${path} at ${new Date().toISOString()}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64')
    };
    if (sha) params.sha = sha;
    
    await octokit.repos.createOrUpdateFileContents(params);
}

// 上传接口
app.post('/api/upload', async (req, res) => {
    try {
        const { deviceId, userName, yearMonth, dailyScores, uploadTime } = req.body;
        if (!userName || !yearMonth || !dailyScores) {
            return res.status(400).json({ error: '缺少字段' });
        }

        const path = `data/${yearMonth}.json`;
        const { content: data, sha } = await getFile(path);
        
        const userId = `${deviceId || 'unknown'}_${userName}`;
        const monthlyTotal = Object.values(dailyScores).reduce((a, b) => a + b, 0);
        
        // 保持原有序号或分配新序号
        const existingIndex = data[userId]?.userIndex;
        
        data[userId] = {
            userName,
            userIndex: existingIndex || Object.keys(data).length + 1,
            deviceId,
            dailyScores,
            monthlyTotal,
            lastUpdate: uploadTime || new Date().toISOString(),
            uploadCount: (data[userId]?.uploadCount || 0) + 1
        };

        await saveFile(path, data, sha);
        
        res.json({ 
            success: true, 
            monthlyTotal,
            userIndex: data[userId].userIndex
        });
        
    } catch (error) {
        console.error('上传失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 查询接口
app.get('/api/data/:yearMonth', async (req, res) => {
    try {
        const path = `data/${req.params.yearMonth}.json`;
        const { content: data } = await getFile(path);
        
        const users = Object.values(data).map(u => ({
            ...u,
            exceedDays: Object.entries(u.dailyScores)
                .filter(([date, score]) => score > DAILY_LIMIT)
                .map(([date, score]) => ({ date, score, limit: DAILY_LIMIT }))
        }));
        
        // 按序号排序
        users.sort((a, b) => a.userIndex - b.userIndex);
        
        res.json({ 
            yearMonth: req.params.yearMonth,
            users, 
            dailyLimit: DAILY_LIMIT,
            totalUsers: users.length
        });
        
    } catch (error) {
        res.json({ yearMonth: req.params.yearMonth, users: [], dailyLimit: DAILY_LIMIT, totalUsers: 0 });
    }
});

// 月份列表
app.get('/api/months', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: 'data'
        });
        
        const months = data
            .filter(f => f.name.endsWith('.json'))
            .map(f => f.name.replace('.json', ''))
            .sort()
            .reverse();
            
        res.json({ months });
    } catch (e) {
        res.json({ months: [] });
    }
});

module.exports = app;
