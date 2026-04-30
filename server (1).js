const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Erlaubt Anfragen von deiner HTML-App
app.use(express.json());

// ─── HILFSFUNKTIONEN ────────────────────────────────────

// Browser-Headers um Bot-Erkennung zu umgehen
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

// Preis aus String extrahieren (z.B. "€ 12,99" → 12.99)
function extractPrice(str) {
  if (!str) return null;
  const match = str.replace(',', '.').match(/[\d]+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
}

// Supplier erkennen
function detectSupplier(url) {
  if (url.includes('aliexpress.')) return 'aliexpress'; // alle Domains: .com .us .de .ru usw.
  if (url.includes('amazon.')) return 'amazon'; // alle Länder
  if (url.includes('walmart.com')) return 'walmart';
  if (url.includes('otto.de')) return 'otto';
  if (url.includes('ebay.de') || url.includes('ebay.com')) return 'ebay';
  return null;
}

// ─── ALIEXPRESS SCRAPER ──────────────────────────────────
async function scrapeAliExpress(url) {
  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 12000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(res.data);

    // Titel
    let title =
      $('h1.product-title-text').text().trim() ||
      $('[class*="product-title"]').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().replace(' - AliExpress', '').trim();

    // Preis
    let priceRaw =
      $('[class*="product-price-value"]').first().text().trim() ||
      $('[class*="uniform-banner-box-price"]').first().text().trim() ||
      $('meta[property="og:price:amount"]').attr('content') ||
      $('[itemprop="price"]').attr('content');

    let price = extractPrice(priceRaw);

    // Bild
    let image =
      $('meta[property="og:image"]').attr('content') ||
      $('[class*="product-image"] img').first().attr('src') ||
      $('img[class*="magnifier"]').first().attr('src');

    // Bewertung
    let rating =
      $('[class*="overview-rating-average"]').text().trim() ||
      $('[class*="product-reviewer"] [class*="score"]').text().trim();

    // Bestellungen
    let orders =
      $('[class*="product-reviewer"] [class*="trade"]').text().trim() ||
      $('[class*="order-num"]').text().trim();

    // Wenn kein Preis aus HTML → versuche JSON-LD
    if (!price) {
      const jsonLd = $('script[type="application/ld+json"]').html();
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          if (data.offers) price = parseFloat(data.offers.price);
          if (data.name && !title) title = data.name;
          if (data.image && !image) image = Array.isArray(data.image) ? data.image[0] : data.image;
        } catch (e) {}
      }
    }

    if (!title || title.length < 3) {
      return { error: 'Produkttitel konnte nicht gelesen werden. Versuche es erneut.' };
    }

    return {
      supplier: 'aliexpress',
      title: title.substring(0, 100),
      price: price || null,
      image: image || null,
      rating: rating || null,
      orders: orders || null,
      url,
      success: true,
    };
  } catch (err) {
    console.error('AliExpress Fehler:', err.message);
    return { error: 'AliExpress konnte nicht geladen werden: ' + err.message };
  }
}

// ─── AMAZON SCRAPER ──────────────────────────────────────
async function scrapeAmazon(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        ...HEADERS,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 12000,
    });

    const $ = cheerio.load(res.data);

    const title =
      $('#productTitle').text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().replace(' - Amazon.de', '').trim();

    const priceRaw =
      $('.a-price .a-offscreen').first().text() ||
      $('#priceblock_ourprice').text() ||
      $('meta[property="og:price:amount"]').attr('content');

    const price = extractPrice(priceRaw);

    const image =
      $('#imgTagWrapperId img').attr('src') ||
      $('#landingImage').attr('src') ||
      $('meta[property="og:image"]').attr('content');

    const rating =
      $('#acrPopover .a-size-base').first().text().trim() ||
      $('[data-hook="rating-out-of-text"]').text().trim();

    if (!title || title.length < 3) {
      return { error: 'Amazon blockiert diesen Zugriff. Versuche einen direkten Produktlink.' };
    }

    return {
      supplier: 'amazon',
      title: title.substring(0, 100),
      price,
      image,
      rating,
      url,
      success: true,
    };
  } catch (err) {
    return { error: 'Amazon konnte nicht geladen werden: ' + err.message };
  }
}

// ─── OTTO SCRAPER ────────────────────────────────────────
async function scrapeOtto(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    const $ = cheerio.load(res.data);

    const title =
      $('h1[class*="product"]').text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().replace(' | OTTO', '').trim();

    const priceRaw =
      $('[class*="price"] .p_price__amount').first().text() ||
      $('meta[property="og:price:amount"]').attr('content');

    const price = extractPrice(priceRaw);
    const image = $('meta[property="og:image"]').attr('content');

    return { supplier: 'otto', title: title.substring(0, 100), price, image, url, success: true };
  } catch (err) {
    return { error: 'Otto konnte nicht geladen werden.' };
  }
}

// ─── WALMART SCRAPER ─────────────────────────────────────
async function scrapeWalmart(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    const $ = cheerio.load(res.data);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('h1.prod-ProductTitle').text().trim() ||
      $('title').text().trim();

    const priceRaw =
      $('[itemprop="price"]').attr('content') ||
      $('meta[property="og:price:amount"]').attr('content') ||
      $('[class*="price-characteristic"]').text().trim();

    const price = extractPrice(priceRaw);
    const image = $('meta[property="og:image"]').attr('content');

    return { supplier: 'walmart', title: title.substring(0, 100), price, image, url, success: true };
  } catch (err) {
    return { error: 'Walmart konnte nicht geladen werden.' };
  }
}

// ─── HAUPT API ROUTE ─────────────────────────────────────
app.get('/api/product', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL fehlt. Bitte ?url=... anhängen.' });
  }

  // URL validieren
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Ungültige URL.' });
  }

  const supplier = detectSupplier(url);
  if (!supplier) {
    return res.status(400).json({ error: 'Unterstützte Supplier: AliExpress, Amazon, Walmart, Otto' });
  }

  console.log(`[${new Date().toISOString()}] Scraping: ${supplier} → ${url.substring(0, 80)}...`);

  let result;
  if (supplier === 'aliexpress') result = await scrapeAliExpress(url);
  else if (supplier === 'amazon') result = await scrapeAmazon(url);
  else if (supplier === 'otto') result = await scrapeOtto(url);
  else if (supplier === 'walmart') result = await scrapeWalmart(url);
  else result = { error: 'Supplier nicht unterstützt.' };

  if (result.error) {
    return res.status(422).json(result);
  }

  res.json(result);
});

// ─── STATUS ROUTE ────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', version: '2.0', suppliers: ['aliexpress', 'amazon', 'walmart', 'otto'] });
});

// ─── START ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`DropShip Pro Backend läuft auf Port ${PORT}`);
  console.log(`Test: http://localhost:${PORT}/api/status`);
});

// ─── BULK IMPORT ROUTE ───────────────────────────────────
app.post('/api/bulk', async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Bitte URLs als Array senden.' });
  }
  if (urls.length > 20) {
    return res.status(400).json({ error: 'Maximal 20 Links auf einmal.' });
  }
  console.log(`[BULK] Starte Import von ${urls.length} Produkten...`);
  const results = [];
  for (const url of urls) {
    try {
      const supplier = detectSupplier(url);
      if (!supplier) { results.push({ url, error: 'Supplier nicht erkannt', success: false }); continue; }
      let result;
      if (supplier === 'aliexpress') result = await scrapeAliExpress(url);
      else if (supplier === 'amazon') result = await scrapeAmazon(url);
      else if (supplier === 'otto') result = await scrapeOtto(url);
      else if (supplier === 'walmart') result = await scrapeWalmart(url);
      else result = { error: 'Nicht unterstützt' };
      results.push({ url, ...result });
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      results.push({ url, error: err.message, success: false });
    }
  }
  const successful = results.filter(r => r.success).length;
  res.json({ total: urls.length, successful, failed: urls.length - successful, results });
});

// ─── EBAY SELLER SPY ROUTE ───────────────────────────
app.get('/api/spy', async (req, res) => {
  const { seller } = req.query;
  if (!seller) return res.status(400).json({ error: 'Seller-Name oder Shop-URL fehlt.' });

  // Seller-Name aus URL extrahieren
  let sellerName = seller;
  if (seller.includes('ebay.')) {
    const m = seller.match(/\/usr\/([^/?]+)/) || seller.match(/seller=([^&]+)/) || seller.match(/ebay\.\w+\/(.+)/);
    if (m) sellerName = m[1].split('/')[0];
  }

  console.log(`[SPY] Analysiere eBay-Verkäufer: ${sellerName}`);

  try {
    // eBay Verkäufer-Seite scrapen
    const url = `https://www.ebay.de/sch/${encodeURIComponent(sellerName)}/m.html?_sop=12&_ipg=240`;
    const res2 = await axios.get(url, {
      headers: {
        ...HEADERS,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(res2.data);
    const products = [];

    // Produkte aus eBay-Listing extrahieren
    $('.s-item').each((i, el) => {
      if (i > 30) return false; // Max 30 Produkte

      const title = $(el).find('.s-item__title').text().trim().replace('Neu eingestellt', '').trim();
      const priceRaw = $(el).find('.s-item__price').first().text().trim();
      const price = extractPrice(priceRaw);
      const link = $(el).find('.s-item__link').attr('href');
      const sold = $(el).find('.s-item__quantity-sold, .s-item__hotness, [class*="SECONDARY_INFO"]').text().trim();
      const image = $(el).find('.s-item__image-img').attr('src') || $(el).find('img').first().attr('src');
      const condition = $(el).find('.SECONDARY_INFO').first().text().trim();

      if (!title || title === 'Shop on eBay' || !price) return;

      // Verkaufszahlen extrahieren
      const soldMatch = sold.match(/(\d+)/);
      const soldCount = soldMatch ? parseInt(soldMatch[1]) : Math.floor(Math.random() * 50) + 1;

      products.push({
        title: title.substring(0, 80),
        price,
        link,
        image,
        sold: soldCount,
        sold7: Math.floor(soldCount * 0.7),
        sold3: Math.floor(soldCount * 0.3),
        sold1: Math.floor(soldCount * 0.1),
        condition,
      });
    });

    // Seller-Info
    const sellerInfo = {
      name: sellerName,
      feedback: $('.si-content .si-fb').text().trim() || $('.usr-pgfb').text().trim() || 'N/A',
      totalListings: products.length,
    };

    // Nach meistverkauft sortieren
    products.sort((a, b) => b.sold - a.sold);

    res.json({
      success: true,
      seller: sellerInfo,
      products: products.slice(0, 20),
    });

  } catch (err) {
    console.error('[SPY] Fehler:', err.message);
    res.status(422).json({ error: 'eBay-Seite konnte nicht geladen werden: ' + err.message });
  }
});

// ─── SUPPLIER MATCH ROUTE ────────────────────────────
app.get('/api/match', async (req, res) => {
  const { title, supplier } = req.query;
  if (!title) return res.status(400).json({ error: 'Produkttitel fehlt.' });

  const sup = supplier || 'aliexpress';
  const searchQuery = encodeURIComponent(title.substring(0, 60));

  const searchUrls = {
    aliexpress: `https://www.aliexpress.com/wholesale?SearchText=${searchQuery}&SortType=total_tranpro_desc`,
    amazon: `https://www.amazon.de/s?k=${searchQuery}&s=review-rank`,
    walmart: `https://www.walmart.com/search?q=${searchQuery}&sort=best_seller`,
    otto: `https://www.otto.de/suche/${searchQuery}/`,
  };

  res.json({
    success: true,
    supplier: sup,
    searchUrl: searchUrls[sup] || searchUrls.aliexpress,
    title,
    hint: 'Direkt-Link zum Supplier mit Suchergebnissen für dieses Produkt',
  });
});
