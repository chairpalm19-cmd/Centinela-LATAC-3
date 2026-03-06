const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3001;

const SYS = `You are a cybersecurity intelligence analyst. Search for REAL, VERIFIED cyber incidents affecting Latin America and the Caribbean (LATAC).

Search these sources: bleepingcomputer.com, thehackernews.com, welivesecurity.com, securityweek.com, darkreading.com, infosecurity-magazine.com, scmagazine.com, zdnet.com, reuters.com, bloomberg.com, CSIS.

Known recent incidents to include:
1. Feb 2026: Hacker jailbroke Claude AI to breach Mexican government — 150GB stolen, 195M taxpayer records. Bloomberg Feb 25 2026.
2. Jan 2026: Chronus Group breached 25 Mexican government institutions, 2.3TB, 36.5M citizens.
3. Jun 2025: C&M Software breach Brazil — insider sold credentials, $140M stolen from six banks via PIX.
4. Feb 2025: Inferno Leaks — 701GB Mexican citizen data on dark web.
5. Nov 2025: Banorte bank breach — 4.8M records.
6. May 2025: APT28 Operation RoundPress targeting Ecuadorian military.
7. 2025: Blind Eagle campaigns across Colombia and Argentina.
8. Aug 2025: Curaçao Tax and Customs ransomware.
9. Jun 2025: Brigada Cyber PMC claimed 7M Paraguayan citizen records.
10. Apr 2025: CJNG cartel cyber ops against Mexican agencies and PEMEX.
11. 2025: RansomHub/LockBit 15% ransomware surge, 450+ incidents.
12. 2025: Chinese APTs targeting LATAM gov and telecom.
13. Apr 2022: Conti ransomware Costa Rica national emergency.
14. Sep 2022: Guacamaya hacktivists leaked military data Mexico, Colombia, Chile.
15. May 2023: Rhysida ransomware Chilean Army.

Return ONLY a JSON array. 15-20 incidents, newest first.
Each object: {"title":"string","source":"string","url":"real URL","date":"YYYY-MM-DD","severity":"critical|high|medium","countries":["names"],"countryCodes":["XX"],"flags":["emoji"],"attackTypes":["string"],"sectors":["string"],"isGov":boolean,"summary":"2-3 sentences","lat":number,"lng":number}`;

const USR = `Search for the latest Latin America and Caribbean cyber incidents. Run multiple searches:
1. "Mexico government breach Claude AI 2026"
2. "Latin America ransomware cyberattack 2025 2026"
3. "Brazil Colombia Caribbean cyber breach 2025"
4. "LATAM cybersecurity incident 2025"
Return 15-20 real verified incidents as a JSON array.`;

function callAnthropic(apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: SYS,
      messages: [{ role: "user", content: USR }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error("Anthropic API error " + response.statusCode));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Parse error")); }
      });
    });

    req.on("error", reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

// Simple in-memory cache
let cache = { data: null, time: 0 };
const CACHE_MS = 60 * 60 * 1000; // 1 hour

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  // Serve incidents
  if (req.url === "/api/incidents") {
    // Return cache if fresh
    if (cache.data && Date.now() - cache.time < CACHE_MS) {
      console.log("Returning cached data");
      res.writeHead(200);
      res.end(JSON.stringify(cache.data));
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }));
      return;
    }

    try {
      console.log("Fetching fresh incidents...");
      const data = await callAnthropic(apiKey);
      const text = data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("\\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const match = clean.match(/\\[[\\s\\S]*\\]/);
      const incidents = JSON.parse(match ? match[0] : clean);
      incidents.sort((a, b) => new Date(b.date) - new Date(a.date));

      cache = { data: incidents, time: Date.now() };
      console.log("Returning", incidents.length, "incidents");
      res.writeHead(200);
      res.end(JSON.stringify(incidents));
    } catch (err) {
      console.error("Error:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Everything else: serve a redirect or 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => console.log("Server running on port " + PORT));
