const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Replace with your database URL if using Realtime Database
    databaseURL: "https://esp32-cfcf4-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.database();
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Serve frontend files

// API Route to receive data from ESP32
app.post('/api/log', async (req, res) => {
    const { id, time, date } = req.body;

    // Allow id === 0 for "No Data Found"
    if ((!id && id !== 0) || !time || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`[RECEIVED] ID: ${id}, Time: ${time}, Date: ${date}`);

    try {
        // Push to Firebase Realtime Database
        const newLogRef = db.ref('logs').push();
        await newLogRef.set({
            id: parseInt(id),
            time: time,
            date: date,
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // Fetch User Name for ESP32 Display
        let displayName = "ID " + id;

        if (parseInt(id) === 0) {
            displayName = "No Data Found";
        } else {
            try {
                const userSnap = await db.ref('users/' + id).once('value');
                if (userSnap.exists()) {
                    displayName = userSnap.val().name;
                }
            } catch (err) {
                console.warn("Could not fetch user name:", err);
            }
        }

        console.log('[SUCCESS] Saved to Firebase. User:', displayName);
        res.status(200).json({ message: 'Success', name: displayName });
    } catch (error) {
        console.error('[ERROR] Firebase save failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API Route to fetch larger dataset for stats (e.g., last 1000)
app.get('/api/stats', async (req, res) => {
    try {
        const snapshot = await db.ref('logs').orderByChild('timestamp').limitToLast(1000).once('value');
        const logs = [];
        snapshot.forEach((child) => {
            logs.unshift(child.val());
        });
        res.json(logs);
    } catch (error) {
        console.error('[ERROR] Fetch stats failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API Route to get logs for Frontend
app.get('/api/logs', async (req, res) => {
    try {
        const snapshot = await db.ref('logs').orderByChild('timestamp').limitToLast(50).once('value');
        const logs = [];
        snapshot.forEach((child) => {
            logs.unshift(child.val()); // Newest first
        });
        res.json(logs);
    } catch (error) {
        console.error('[ERROR] Fetch logs failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API Route for AI Chat
app.post('/api/chat', async (req, res) => {
    const { question } = req.body;
    if (!question) {
        return res.status(400).json({ error: 'Missing question' });
    }

    try {
        // 1. Fetch data from Firebase (Get last 1000 logs for context)
        // Optimization: In real app, might want to filter by date based on question, but for now grab all recent.
        const snapshot = await db.ref('logs').limitToLast(500).once('value');
        const data = snapshot.val();

        if (!data) {
            return res.json({ answer: "Chưa có dữ liệu chấm công nào để phân tích." });
        }

        // Convert object to array for lighter token usage
        const logs = Object.values(data).map(log => ({
            id: log.id,
            time: log.time,
            date: log.date
        }));

        // 2. Prepare Prompt
        const prompt = `
Bạn là trợ lý nhân sự thông minh. Hãy phân tích dữ liệu chấm công dưới đây và trả lời câu hỏi của người dùng.
Dữ liệu (JSON): ${JSON.stringify(logs)}

Câu hỏi: "${question}"

Yêu cầu:
- Trả lời bằng tiếng Việt tự nhiên.
- Nếu câu hỏi về tổng hợp (ví dụ: tháng này, năm nay), hãy tự tính toán dựa trên dữ liệu.
- Nếu không có dữ liệu liên quan, hãy nói "Tôi không tìm thấy thông tin này trong dữ liệu gần đây".
`;

        // 3. Call Gemini
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ answer: text });

    } catch (error) {
        console.error('[AI ERROR]', error);
        res.status(500).json({ error: 'AI processing failed' });
    }
});

// API Route to get logs by Date (History)
app.get('/api/history', async (req, res) => {
    const { date } = req.query; // Format: DD/MM/YYYY
    if (!date) {
        return res.status(400).json({ error: 'Missing date parameter' });
    }

    console.log(`[HISTORY] Fetching logs for: ${date}`);

    try {
        // Firebase queries need an index on 'date'
        const snapshot = await db.ref('logs').orderByChild('date').equalTo(date).once('value');
        const logs = [];
        snapshot.forEach((child) => {
            logs.unshift(child.val()); // Newest first (if timestamps align, otherwise sort later)
        });

        // Sort by timestamp descending to be sure
        logs.sort((a, b) => b.timestamp - a.timestamp);

        res.json(logs);
    } catch (error) {
        console.error('[ERROR] Fetch history failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API Route to Get Users
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const usersObj = snapshot.val() || {};
        // Convert object to array
        const users = Object.keys(usersObj).map(key => ({
            id: key,
            ...usersObj[key]
        }));
        res.json(users);
    } catch (error) {
        console.error('[ERROR] Fetch users failed:', error);
        res.status(500).json({ error: 'Internet Server Error' });
    }
});

// API Route to Add/Update User
app.post('/api/users', async (req, res) => {
    try {
        const userData = req.body; // Expect { id, name, yob, cccd, position, gender, hometown, address }

        if (!userData.id) {
            // If ID is simple (1, 2, 3...), user might provide it. 
            // Or we can generate one. For fingerprint, ID is usually an integer index (1-127).
            return res.status(400).json({ error: 'User ID is required' });
        }

        await db.ref('users/' + userData.id).set(userData);
        console.log(`[USER] Saved user: ${userData.name} (ID: ${userData.id})`);
        res.json({ success: true, message: 'User saved successfully' });
    } catch (error) {
        console.error('[ERROR] Save user failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



// API Route to Delete User
app.delete('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        await db.ref('users/' + userId).remove();
        console.log(`[USER] Deleted user: ${userId}`);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('[ERROR] Delete user failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API Route to test server
app.get('/api/status', (req, res) => {
    res.json({ status: 'Online', firewall: 'Firebase Connected' });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nLocal IoT Server running at: http://localhost:${PORT}`);
    console.log(`ESP32 should send POST to: http://<YOUR_IP>:${PORT}/api/log\n`);
});
