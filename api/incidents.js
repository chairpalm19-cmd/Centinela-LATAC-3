const https = require("https");

const SYS = `You are a cybersecurity intelligence analyst for a LATAC (Latin America & Caribbean) threat dashboard. Return REAL, VERIFIED cyber incidents from your training knowledge. Do NOT invent or fabricate any incidents.

Include these known incidents (you know about all of them):

CRITICAL — 2026:
- Feb 2026: Hacker jailbroke Anthropic's Claude AI to breach Mexican government agencies (SAT, INE, state govs). 150GB stolen including 195M taxpayer records, voter data, employee credentials. Discovered by Gambit Security, reported by Bloomberg Feb 25 2026. Attack ran Dec 2025-Jan 2026.
- Jan 2026: Chronus Group claimed breach of 25 Mexican government institutions, 2.3TB data, 36.5M citizens affected. Healthcare system data included.

HIGH — 2025:
- Jun 2025: C&M Software breach in Brazil — insider sold credentials for $2,760, hackers stole $140M from six banks via PIX system. Largest cyberattack on Brazil's financial system. Employee arrested Jul 4.
- Feb 2025: Inferno Leaks — InjectionInferno sold 701GB of Mexican citizen data on dark web (electoral, banking, tax data).
- Nov 2025: Alleged Banorte bank breach — 4.8M customer records.
- May 2025: APT28 (Fancy Bear) Operation RoundPress targeted Ecuadorian military via Roundcube webmail exploits.
- 2025: Blind Eagle (APT-C-36) malware campaigns across Colombia and Argentina — 1,600+ victims, 8,000 PII entries stolen.
- Aug 2025: Curaçao Tax and Customs Administration hit by ransomware.
- Apr 2025: CJNG cartel cyber operations targeting Mexican national security agencies and PEMEX.
- Jun 2025: Brigada Cyber PMC claimed 7M Paraguayan citizen records, demanded $7.4M ransom ($1 per citizen).
- 2025: RansomHub and LockBit drove 15% ransomware surge across LATAM. 450+ incidents tracked by Intel 471 (78% increase over 2024).
- 2025: Chinese APT groups (Earth Alux, VIXEN PANDA, AQUATIC PANDA, LIMINAL PANDA) targeting LATAM gov and telecom.
- 2025: 1 billion stolen LATAM credentials found on underground markets per CrowdStrike.
- 2025: Lucid PhaaS platform stealing credit card data across Mexico, Brazil, Colombia, Argentina, Chile.

HISTORICAL:
- Apr 2022: Conti ransomware hit Costa Rica — national emergency declared, 27 agencies affected.
- Sep 2022: Guacamaya hacktivists leaked military data from Mexico SEDENA, Colombia, Chile, Peru.
- May 2023: Rhysida ransomware attacked Chilean Army — 360,000 classified documents leaked.

Return ONLY a JSON array (no markdown, no backticks, no extra text). 15-20 incidents, newest first.

Each object must have:
{"title":"string max 120 chars","source":"real publication name","url":"real article URL","date":"YYYY-MM-DD","severity":"critical|high|medium","countries":["names"],"countryCodes":["XX"],"flags":["emoji"],"attackTypes":["Ransomware"|"Data Breach"|"Phishing"|"State Actor"|"DDoS"|"Malware"|"Insider Threat"|"Supply Chain"],"sectors":["GOV"|"FINANCE"|"HEALTH"|"INFRA"|"ENERGY"|"TELECOM"|"MILITARY"|"EDUCATION"],"isGov":boolean,"summary":"2-3 real sentences","lat":number,"lng":number}`;

const USR = "Return 15-20 verified LATAC cyber incidents from your knowledge as a JSON array. Include the Mexico Claude AI breach, C&M Software Brazil heist, Chronus Group, Inferno Leaks, Caribbean incidents, and other major 2025-2026 incidents. Every URL must be a real published article. Every date must be accurate.";

function callAnthropic(apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: SYS,
      messages: [{ role: "user", content: USR }],
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

    console.log("Calling Anthropic API (no web search)...");

    const req = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        console.log("Response status:", response.statusCode);
        if (response.statusCode !== 200) {
          reject(new Error("Anthropic API error " + response.statusCode + ": " + data.substring(0, 500)));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Parse error: " + e.message));
        }
      });
    });

    req.on("error", (e) => {
      console.error("Request error:", e.message);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  console.log("Function started");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");

  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("No API key");
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    const data = await callAnthropic(apiKey);
    console.log("Content blocks:", data.content?.length);

    const text = data.content
      ?.map((b) => (b.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n");

    if (!text) {
      return res.status(500).json({ error: "No text in response" });
    }

    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    const incidents = JSON.parse(match ? match[0] : clean);

    if (!Array.isArray(incidents) || incidents.length === 0) {
      return res.status(500).json({ error: "No incidents parsed" });
    }

    console.log("Returning", incidents.length, "incidents");
    incidents.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.status(200).json(incidents);
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
