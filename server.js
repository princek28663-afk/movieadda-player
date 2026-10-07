import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';

const app = express();
app.use(cors());

// Cache (एक ही ID के लिए बार-बार स्क्रैप न करें)
const cache = new Map();
const CACHE_TIME = 30 * 60 * 1000; // 30 मिनट

app.get('/player/:tmdbId', async (req, res) => {
    const tmdbId = req.params.tmdbId.replace(/[^0-9]/g, '');
    const type = req.query.type || 'movie'; // movie या tv
    const season = req.query.season || 1;
    const episode = req.query.episode || 1;

    if (!tmdbId) {
        return res.status(400).json({ error: 'TMDB ID required' });
    }

    const cacheKey = `${tmdbId}-${type}-${season}-${episode}`;

    // Cache से देखें
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.time < CACHE_TIME) {
            console.log('✅ From cache:', cacheKey);
            return res.json(cached.data);
        }
    }

    let streamUrl = null;
    let browser = null;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });

        const page = await context.newPage();

        // नेटवर्क रिक्वेस्ट को पकड़ें
        const streamUrls = [];
        page.on('response', (response) => {
            const url = response.url();
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                streamUrls.push(url);
                console.log('🎬 Found stream:', url);
            }
        });

        // vidrift का embed URL बनाएँ
        let embedUrl;
        if (type === 'tv') {
            embedUrl = `https://embed.vidrift.net/embed/tv/${tmdbId}/${season}/${episode}`;
        } else {
            embedUrl = `https://embed.vidrift.net/embed/movie/${tmdbId}`;
        }

        console.log('🔍 Opening:', embedUrl);
        await page.goto(embedUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });

        // Play बटन दबाएँ (अगर ज़रूरी हो)
        try {
            await page.waitForTimeout(3000);
            // कभी-कभी play बटन दबाना पड़ता है
            const playBtn = await page.$('video, button[aria-label*="play"], .play-button');
            if (playBtn) {
                await playBtn.click().catch(() => {});
            }
        } catch (e) {}

        // 15 सेकंड इंतज़ार करें ताकि सारी रिक्वेस्ट आ जाएँ
        await page.waitForTimeout(15000);

        // सबसे अच्छा लिंक चुनें
        streamUrl = streamUrls.find(u => u.includes('.m3u8')) || streamUrls[0] || null;

        await browser.close();
        browser = null;

        const responseData = [{
            success: !!streamUrl,
            tmdbId: tmdbId,
            type: type,
            stream: streamUrl,
            referer: 'https://embed.vidrift.net/',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }];

        if (streamUrl) {
            cache.set(cacheKey, { data: responseData, time: Date.now() });
            console.log('✅ Success:', streamUrl);
        }

        res.json(responseData);

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (browser) await browser.close();
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Cache साफ़ करने का endpoint
app.get('/clear-cache', (req, res) => {
    cache.clear();
    res.json({ message: 'Cache cleared' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🎬 Embed server running on port ${PORT}`);
});
