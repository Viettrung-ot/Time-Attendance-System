require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function tryModel(modelName) {
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        await model.generateContent("Hi");
        console.log(`PASS: ${modelName}`);
        return true;
    } catch (error) {
        console.log(`FAIL: ${modelName} - ${error.status || error.message}`);
        return false;
    }
}

async function run() {
    await tryModel("gemini-2.5-flash");
    await tryModel("gemini-flash-latest");
}

run();
