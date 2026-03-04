// Vercel Serverless Function: /api/incidents
// This keeps your Anthropic API key secret on the server side.
// Set ANTHROPIC_API_KEY in your Vercel project environment variables.

const SYS = `You are a cybersecurity intelligence analyst. Search for REAL, VERIFIED cyber incidents affecting Latin America and the Caribbean (LATAC).

You MUST search broadly using multiple queries across these sources:
- bleepingcomputer.com, thehackernews.com, welivesecurity.com (ESET — very active in LATAC)
- securityweek.com, darkreading.com, infosecurity-magazine.com, scmagazine.com, zdnet.com
- reuters.com, bloomberg.com (for major breaches)
- CSIS significant cyber incidents timeline

Known recent incidents you MUST search for and include:
1. Feb 2026: Hackers used Anthropic Claude AI to breach Mexican government — 150GB stolen, 195M taxpayer records (Bloomberg broke this Feb 25 2026)
2. Jan-Feb 2026: "Chronus" hacker group breached 25 Mexican government agencies, 36.5M citizens exposed
3. Feb 2025: "Inferno Leaks" — 701GB Mexican citizen data sold on dark web by InjectionInferno
4. Nov 2025: Alleged Banorte bank breach — 4.8M records
5. 2025: CJNG cartel cyber operations against Mexican national security agencies and PEMEX
6. May 2025: APT28 Operation RoundPress targeting Ecuadorian military
7. 2025: Blind Eagle (APT-C-36) campaigns across Colombia and Argentina
8. Aug 2025: Curaçao Tax and Customs ransomware attack
9. Any other Caribbean, Brazilian, Colombian, Argentine, Chilean, Peruvian, Costa Rican incidents from 2025-2026

Return ONLY a JSON array (no markdown, no backticks, no text before or after). 15-20 incidents sorted newest first.

Each object MUST have these exact fields:
{"title":"string max 120 chars","source":"publication name","url":"real article URL","date":"YYYY-MM-DD actual publication date","severity":"critical|high|medium","countries":["country names"],"countryCodes":["XX two-letter ISO codes"],"flags":["emoji flags"],"attackTypes":["Ransomware"|"Data Breach"|"Phishing"|"State Actor"|"DDoS"|"Malware"|"Supply Chain"],"sectors":["GOV"|"FINANCE"|"HEALTH"|"INFRA"|"ENERGY"|"TELECOM"|"EDUCATION"],"isGov":boolean,"summary":"2-3 sentences with real details","lat":number,"lng":number}`;

const USR = `Search extensively for Latin America and Caribbean cyber incidents from the past 12 months. Run these searches:

1. "Mexico government breach Claude AI 2026 hacker 150GB taxpayer Bloomberg"
2. "Chronus hackers Mexico government agencies breach 2026"
3. "Inferno Leaks Mexico dark web 701GB 2025"
4. "Latin America ransomware cyberattack breach 2025 2026"
5. "Caribbean cyberattack Jamaica Trinidad Curaçao Dominican Republic 2025"
6. "Brazil cyber breach ransomware 2025 2026"
7. "Colombia Argentina Chile Peru cyber incident 2025"
8. "Banorte Mexico bank data breach 2025"
9. "LATAM cybersecurity welivesecurity ESET 2025 2026"
10. "Blind Eagle APT-C-36 Colombia Argentina malware 2025"

Return 15-20 REAL verified incidents as a JSON array. Every URL must be real. Every date must be the actual publication date. Do NOT invent any incidents.`;

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800"); // Cache 15min

  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 6000,
        system: SYS,
        messages: [{ role: "user", content: USR }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${err}` });
    }

    const data = await response.json();
    const text = data.content
      ?.map((b) => (b.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n");

    if (!text) {
      return res.status(500).json({ error: "No text in API response" });
    }

    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    const incidents = JSON.parse(match ? match[0] : clean);

    if (!Array.isArray(incidents) || incidents.length === 0) {
      return res.status(500).json({ error: "No incidents parsed" });
    }

    incidents.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.status(200).json(incidents);
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
