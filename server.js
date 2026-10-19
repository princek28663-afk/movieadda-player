import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';

const app = express();
app.use(cors());

// लिंक को कैश करने के लिए (ताकि बार-बार स्क्रैप न करना पड़े)
const cache = new Map();

app.get('/api/stream', async (req, res) => {
    const { id, type, s, e } = req.query; // id=TMDB ID, type=movie/tv, s=season, e=episode
    
    if (!id) return res.status(400).json({ error: 'TMDB ID required' });

    const cacheKey = `${id}-${type}-${s}-${e}`;
    
    // अगर कैश में है तो सीधे भेज दो
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.time < 30 * 60 * 1000) { // 30 मिनट तक वैध
            return res.json(cached.data);
        }
    }

    let browser = null;
    try {
        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        
        // Vidrift का URL बनाएँ
        let embedUrl = type === 'tv' 
            ? `https://embed.vidrift.net/embed/tv/${id}/${s}/${e}` 
            : `https://embed.vidrift.net/embed/movie/${id}`;

        console.log('Scraping:', embedUrl);
        
        let streamUrl = null;
        // नेटवर्क रिक्वेस्ट में .m3u8 को पकड़ें
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8') && !streamUrl) {
                streamUrl = url;
            }
        });

        await page.goto(embedUrl, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(10000); // 10 सेकंड वीडियो लोड होने दें

        await browser.close();

        if (!streamUrl) throw new Error('Stream not found');

        const responseData = {
            success: true,
            stream: streamUrl,
            referer: 'https://embed.vidrift.net/'
        };

        // कैश में सेव करें
        cache.set(cacheKey, { data: responseData, time: Date.now() });
        res.json(responseData);

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
