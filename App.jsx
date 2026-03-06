import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

/* ─── TopoJSON mini-decoder (no external lib needed) ─── */
function decodeTopo(topo, objName) {
  const tf = topo.transform || { scale: [1,1], translate: [0,0] };
  const arcs = topo.arcs.map(arc => {
    let x=0, y=0;
    return arc.map(([dx,dy]) => { x+=dx; y+=dy; return [x*tf.scale[0]+tf.translate[0], y*tf.scale[1]+tf.translate[1]]; });
  });
  const getArc = i => i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
  const ring = idxs => { let c=[]; idxs.forEach(i => { const a=getArc(i); c=c.concat(a); }); return c; };
  const obj = topo.objects[objName];
  if (!obj) return { type:"FeatureCollection", features:[] };
  return {
    type: "FeatureCollection",
    features: obj.geometries.map(g => ({
      type: "Feature", properties: g.properties||{}, id: g.id,
      geometry: g.type==="Polygon" ? { type:"Polygon", coordinates: g.arcs.map(ring) }
        : g.type==="MultiPolygon" ? { type:"MultiPolygon", coordinates: g.arcs.map(a=>a.map(ring)) }
        : { type:"Point", coordinates:[0,0] }
    })).filter(f => f.geometry.type !== "Point")
  };
}

/* ─── LATAC numeric ISO IDs for filtering countries-110m ─── */
const LATAC_IDS = new Set([
  "032","068","076","152","170","188","192","214","218","222",
  "320","328","332","340","388","484","558","591","600","604",
  "740","780","858","862","044",
]);
const ID_TO_CC = {"484":"MX","320":"GT","340":"HN","222":"SV","558":"NI","188":"CR","591":"PA","170":"CO","862":"VE","218":"EC","604":"PE","076":"BR","068":"BO","600":"PY","152":"CL","032":"AR","858":"UY","328":"GY","740":"SR","192":"CU","388":"JM","332":"HT","214":"DO","780":"TT","044":"BS"};

/* ─── Country coord lookup ─── */
const CC = {
  MX:{lat:23.6,lng:-102.5},BR:{lat:-14.2,lng:-51.9},CO:{lat:4.6,lng:-74.1},
  AR:{lat:-38.4,lng:-63.6},CL:{lat:-35.7,lng:-71.5},PE:{lat:-9.2,lng:-75},
  EC:{lat:-1.8,lng:-78.2},VE:{lat:6.4,lng:-66.6},BO:{lat:-16.3,lng:-63.6},
  PY:{lat:-23.4,lng:-58.4},UY:{lat:-32.5,lng:-55.8},CR:{lat:9.7,lng:-83.8},
  PA:{lat:8.5,lng:-80.8},GT:{lat:15.8,lng:-90.2},HN:{lat:15.2,lng:-86.2},
  SV:{lat:13.8,lng:-88.9},NI:{lat:12.9,lng:-85.2},DO:{lat:18.7,lng:-70.2},
  CU:{lat:21.5,lng:-77.8},JM:{lat:18.1,lng:-77.3},HT:{lat:19,lng:-72.4},
  TT:{lat:10.5,lng:-61.3},BB:{lat:13.2,lng:-59.5},BS:{lat:25,lng:-77.4},
  PR:{lat:18.2,lng:-66.5},CW:{lat:12.2,lng:-69},GY:{lat:5,lng:-59},SR:{lat:4,lng:-56},
};

const SEV_COL = { critical:"#dc2626", high:"#f59e0b", medium:"#0071e3", low:"#34c759" };
const SEV_BG = { critical:"#fff0f0", high:"#fff8ee", medium:"#eef5ff", low:"#f0fdf4" };

function timeAgo(ds) {
  if (!ds) return "Unknown";
  const d=new Date(ds); if(isNaN(d)) return ds;
  const s=(Date.now()-d)/1000;
  if(s<0) return "Just now";
  if(s<3600) return Math.floor(s/60)+"m ago";
  if(s<86400) return Math.floor(s/3600)+"h ago";
  if(s<604800) return Math.floor(s/86400)+"d ago";
  if(s<2592000) return Math.floor(s/604800)+"w ago";
  if(s<31536000) return Math.floor(s/2592000)+"mo ago";
  return Math.floor(s/31536000)+"y ago";
}
function daysAgo(ds) { if(!ds) return Infinity; const d=new Date(ds); return isNaN(d)?Infinity:(Date.now()-d)/864e5; }
function fmtDate(ds) { if(!ds) return "Unknown"; const d=new Date(ds); return isNaN(d)?ds:d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }

const PERIODS = [
  {key:"live",label:"🔴 Live",days:Infinity},{key:"7d",label:"Past Week",days:7},
  {key:"1m",label:"1 Month",days:30},{key:"3m",label:"3 Months",days:90},
  {key:"6m",label:"6 Months",days:180},{key:"1y",label:"Last Year",days:365},
];
const FILTERS = [
  {key:"all",label:"All LATAC"},{key:"critical",label:"Critical"},{key:"ransomware",label:"Ransomware"},
  {key:"gov",label:"Government"},{key:"finance",label:"Finance"},{key:"infra",label:"Infrastructure"},
];

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

/* ─── SYSTEM PROMPT ─── */
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

/* ═══════════════ THREAT MAP ═══════════════ */
function ThreatMap({ incidents, period, geoData }) {
  const svgRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const pDays = PERIODS.find(p=>p.key===period)?.days ?? Infinity;
  const vis = incidents.filter(i=>daysAgo(i.date)<=pDays);

  useEffect(() => {
    if (!svgRef.current) return;
    const el = svgRef.current;
    const svg = d3.select(el);
    svg.selectAll("*").remove();
    const w = el.clientWidth || 720;
    const h = 480;

    const proj = d3.geoMercator().center([-68,5]).scale(Math.min(w,h)*0.78).translate([w/2,h/2]);
    const path = d3.geoPath().projection(proj);

    // Ocean background
    svg.append("rect").attr("width",w).attr("height",h).attr("fill","#edf2f7");

    // Graticule
    svg.append("path").datum(d3.geoGraticule().step([10,10])())
      .attr("d",path).attr("fill","none").attr("stroke","rgba(0,113,227,0.06)").attr("stroke-width",0.5);

    // Draw country shapes if available
    if (geoData && geoData.features.length > 0) {
      const hitCodes = new Set();
      vis.forEach(i => i.countryCodes?.forEach(c => hitCodes.add(c)));

      // Non-LATAC countries (faded context)
      const others = geoData.features.filter(f => !LATAC_IDS.has(String(f.id).padStart(3,"0")));
      svg.selectAll(".bg-country").data(others).enter().append("path")
        .attr("d",path).attr("fill","#dde1e7").attr("stroke","#c8cdd4").attr("stroke-width",0.3);

      // LATAC countries
      const latac = geoData.features.filter(f => LATAC_IDS.has(String(f.id).padStart(3,"0")));
      svg.selectAll(".latac-country").data(latac).enter().append("path")
        .attr("d",path)
        .attr("fill", d => {
          const cc2 = ID_TO_CC[String(d.id).padStart(3,"0")];
          return hitCodes.has(cc2) ? "rgba(0,113,227,0.18)" : "#f0f2f5";
        })
        .attr("stroke","#8b95a5").attr("stroke-width",0.7);
    }

    // Aggregate by country
    const byCC = {};
    vis.forEach(item => {
      item.countryCodes?.forEach((cc,j) => {
        const c = CC[cc]; if(!c) return;
        if(!byCC[cc]) byCC[cc]={cc,items:[],lat:c.lat,lng:c.lng,maxSev:"medium",flag:item.flags?.[j]||""};
        byCC[cc].items.push(item);
        const so={critical:3,high:2,medium:1};
        if((so[item.severity]||0)>(so[byCC[cc].maxSev]||0)) byCC[cc].maxSev=item.severity;
      });
    });
    const nodes = Object.values(byCC);
    const maxN = Math.max(...nodes.map(n=>n.items.length),1);

    // Draw markers
    nodes.forEach(node => {
      const [x,y] = proj([node.lng,node.lat]);
      if(x==null||y==null||isNaN(x)||isNaN(y)) return;
      const r = 10 + (node.items.length/maxN)*16;
      const col = SEV_COL[node.maxSev]||SEV_COL.medium;

      // Animated pulse ring
      const p1 = svg.append("circle").attr("cx",x).attr("cy",y).attr("r",r)
        .attr("fill","none").attr("stroke",col).attr("stroke-width",1.5).attr("opacity",0);
      p1.append("animate").attr("attributeName","r").attr("from",r).attr("to",r+20).attr("dur","2.5s").attr("repeatCount","indefinite");
      p1.append("animate").attr("attributeName","opacity").attr("values","0.5;0").attr("dur","2.5s").attr("repeatCount","indefinite");

      // Glow
      svg.append("circle").attr("cx",x).attr("cy",y).attr("r",r+4)
        .attr("fill",col).attr("fill-opacity",0.08);

      // Main marker
      svg.append("circle").attr("cx",x).attr("cy",y).attr("r",r)
        .attr("fill",col).attr("fill-opacity",0.22).attr("stroke",col).attr("stroke-width",2)
        .attr("cursor","pointer")
        .on("click",()=>setSelected(node))
        .on("mouseenter",function(){d3.select(this).attr("fill-opacity",0.4);})
        .on("mouseleave",function(){d3.select(this).attr("fill-opacity",0.22);});

      // Count
      svg.append("text").attr("x",x).attr("y",y+1).attr("text-anchor","middle").attr("dominant-baseline","middle")
        .attr("fill",col).attr("font-size",r>16?"13px":"11px").attr("font-weight","700")
        .attr("font-family","DM Sans,sans-serif").attr("pointer-events","none").text(node.items.length);

      // Flag
      svg.append("text").attr("x",x).attr("y",y+r+14).attr("text-anchor","middle")
        .attr("font-size","14px").attr("pointer-events","none").text(node.flag);
    });

    // Legend
    const lg = svg.append("g").attr("transform",`translate(${w-160},${h-70})`);
    lg.append("rect").attr("x",-10).attr("y",-10).attr("width",156).attr("height",66).attr("rx",8).attr("fill","rgba(255,255,255,0.85)").attr("stroke","rgba(0,0,0,0.06)");
    [{l:"Critical",c:SEV_COL.critical,y:6},{l:"High",c:SEV_COL.high,y:22},{l:"Medium",c:SEV_COL.medium,y:38}].forEach(s=>{
      lg.append("circle").attr("cx",8).attr("cy",s.y).attr("r",5).attr("fill",s.c).attr("fill-opacity",0.3).attr("stroke",s.c).attr("stroke-width",1.5);
      lg.append("text").attr("x",20).attr("y",s.y+1).attr("dominant-baseline","middle").attr("font-size","10px").attr("font-weight","600").attr("fill","#6e6e73").attr("font-family","DM Sans").text(s.l);
    });
  }, [vis, geoData, period]);

  return (
    <div style={{display:"flex",gap:16}}>
      <div style={{flex:1,background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)",position:"relative"}}>
        <div style={{position:"absolute",top:14,left:18,fontSize:10,fontWeight:600,color:"#6e6e73",letterSpacing:".04em",zIndex:2,background:"rgba(255,255,255,.85)",padding:"4px 10px",borderRadius:8}}>
          LATAC THREAT MAP — {vis.length} incident{vis.length!==1?"s":""} · click a marker for details
        </div>
        {!geoData && <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:12,color:"#6e6e73"}}>Loading map data…</div>}
        <svg ref={svgRef} style={{width:"100%",height:480}} />
      </div>
      <div style={{width:280,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{background:"white",borderRadius:16,padding:"16px 18px",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)",flex:1,overflow:"auto",maxHeight:480}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#6e6e73",marginBottom:12}}>
            {selected ? `${selected.flag} ${selected.items[0]?.countries?.[0]||selected.cc} — ${selected.items.length} incident${selected.items.length!==1?"s":""}` : "Select a country"}
          </div>
          {selected ? selected.items.map((item,i)=>(
            <div key={i} onClick={()=>item.url&&window.open(item.url,"_blank")}
              style={{padding:"10px 0",borderBottom:"1px solid rgba(0,0,0,.06)",cursor:"pointer",fontSize:12}}>
              <div style={{fontWeight:600,lineHeight:1.4,marginBottom:4}}>{item.title}</div>
              <div style={{display:"flex",gap:6,alignItems:"center",color:"#6e6e73",fontSize:11,flexWrap:"wrap"}}>
                <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",padding:"2px 6px",borderRadius:10,background:SEV_BG[item.severity],color:SEV_COL[item.severity]}}>{item.severity}</span>
                <span>{fmtDate(item.date)}</span>
                <span>{timeAgo(item.date)}</span>
                {item.isGov&&<span style={{color:"#dc2626"}}>🏛</span>}
              </div>
            </div>
          )) : <div style={{color:"#aaa",fontSize:12,textAlign:"center",padding:"40px 10px",lineHeight:1.6}}>Click a pulsing marker on the map to see incident details for that country.</div>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ MAIN APP ═══════════════ */
export default function CentinelaLATAC() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState("feed");
  const [period, setPeriod] = useState("live");
  const [filter, setFilter] = useState("all");
  const [clock, setClock] = useState(new Date().toLocaleTimeString());
  const [dots, setDots] = useState("");
  const [geoData, setGeoData] = useState(null);
  const fetchedRef = useRef(false);

  useEffect(()=>{const t=setInterval(()=>setClock(new Date().toLocaleTimeString()),1e3);return()=>clearInterval(t);},[]);
  useEffect(()=>{if(loading){const t=setInterval(()=>setDots(d=>d.length>=3?"":d+"."),400);return()=>clearInterval(t);}},[loading]);

  // Load TopoJSON world map
  useEffect(()=>{
    fetch(TOPO_URL)
      .then(r=>{if(!r.ok) throw new Error("Map fetch failed"); return r.json();})
      .then(topo=>{
        const geo = decodeTopo(topo, "countries");
        if(geo.features.length>0) setGeoData(geo);
      })
      .catch(e=>console.warn("Map data load failed:",e));
  },[]);

  const doFetch = useCallback(async()=>{
    if(fetchedRef.current) return;
    fetchedRef.current=true; setLoading(true); setError(null);
    try {
  const res = await fetch(window.location.origin + "/api/incidents");
      if(!res.ok) throw new Error(`API error ${res.status}`);
      const arr = await res.json();
      if(!Array.isArray(arr)||!arr.length) throw new Error("No incidents returned");
      // Ensure coords
      arr.forEach(it=>{
        if(it.countryCodes?.length){
          const c=CC[it.countryCodes[0]];
          if(c){if(!it.lat||it.lat===0)it.lat=c.lat;if(!it.lng||it.lng===0)it.lng=c.lng;}
        }
      });
      arr.sort((a,b)=>new Date(b.date)-new Date(a.date));
      setIncidents(arr);
    } catch(e){console.error(e);setError(e.message);}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{doFetch();},[doFetch]);

  const pDays=PERIODS.find(p=>p.key===period)?.days??Infinity;
  const filtered=incidents.filter(i=>{
    if(daysAgo(i.date)>pDays) return false;
    if(filter==="critical") return i.severity==="critical";
    if(filter==="ransomware") return i.attackTypes?.some(t=>t.toLowerCase().includes("ransom"));
    if(filter==="gov") return i.isGov;
    if(filter==="finance") return i.sectors?.includes("FINANCE");
    if(filter==="infra") return i.sectors?.some(s=>["INFRA","ENERGY","TELECOM"].includes(s));
    return true;
  });

  const cStats={}; incidents.forEach(i=>i.countries?.forEach((c,j)=>{if(!cStats[c])cStats[c]={name:c,flag:i.flags?.[j]||"🏳",count:0};cStats[c].count++;}));
  const sortC=Object.values(cStats).sort((a,b)=>b.count-a.count).slice(0,8);
  const maxCt=sortC[0]?.count||1;
  const aStats={}; incidents.forEach(i=>i.attackTypes?.forEach(t=>{aStats[t]=(aStats[t]||0)+1;}));
  const sortA=Object.entries(aStats).sort((a,b)=>b[1]-a[1]).slice(0,6);

  const cards=[
    {l:"Total Incidents",v:incidents.length,s:"LATAC-confirmed",c:"#0071e3"},
    {l:"Critical",v:incidents.filter(i=>i.severity==="critical").length,s:"Immediate action",c:"#dc2626"},
    {l:"Countries",v:Object.keys(cStats).length,s:"Active targets",c:"#ff9500"},
    {l:"Gov. Targets",v:incidents.filter(i=>i.isGov).length,s:"State entities",c:"#af52de"},
    {l:"Sources",v:new Set(incidents.map(i=>i.source)).size,s:"Intel feeds",c:"#34c759"},
  ];

  const doRefresh=()=>{fetchedRef.current=false;doFetch();};

  return (
    <div style={{background:"#f5f5f7",minHeight:"100vh",fontFamily:"'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif",color:"#1d1d1f"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet"/>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .crd:hover{box-shadow:0 4px 12px rgba(0,0,0,.08),0 20px 48px rgba(0,0,0,.06)!important;transform:translateY(-1px)!important}
      `}</style>

      {/* Header */}
      <div style={{background:"rgba(255,255,255,.72)",backdropFilter:"saturate(180%) blur(20px)",WebkitBackdropFilter:"saturate(180%) blur(20px)",borderBottom:"1px solid rgba(0,0,0,.06)",position:"sticky",top:0,zIndex:100,padding:"0 28px",height:56,display:"flex",alignItems:"center"}}>
        <div style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:20,fontWeight:700,letterSpacing:"-.02em"}}>Centinela<span style={{color:"#0071e3"}}>.</span></div>
        <div style={{marginLeft:12,fontSize:10,fontWeight:600,background:"linear-gradient(135deg,#0071e3,#00c7ff)",color:"white",padding:"3px 10px",borderRadius:20,letterSpacing:".04em",textTransform:"uppercase"}}>LATAC</div>
        <div style={{fontSize:9,color:"#6e6e73",marginLeft:10}}>Latin America & Caribbean</div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:16}}>
          {!loading&&!error&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,fontWeight:600,color:"#dc2626"}}><div style={{width:7,height:7,borderRadius:"50%",background:"#dc2626",animation:"pulse 1.5s infinite"}}/>LIVE</div>}
          <div style={{fontSize:12,color:"#6e6e73",fontWeight:500}}>{clock}</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{display:"flex",gap:4,padding:"8px 28px",background:"#f5f5f7",borderBottom:"1px solid rgba(0,0,0,.06)"}}>
        {[{k:"feed",l:"📡 Live Feed"},{k:"map",l:"🗺 Threat Map"},{k:"hist",l:"🕰 Historical"}].map(n=>(
          <button key={n.k} onClick={()=>setPage(n.k)} style={{fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"8px 18px",border:"none",borderRadius:20,background:page===n.k?"#1d1d1f":"transparent",color:page===n.k?"white":"#6e6e73",cursor:"pointer",transition:"all .2s"}}>{n.l}</button>
        ))}
      </div>

      {loading ? (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"70vh",gap:20}}>
          <div style={{width:40,height:40,border:"3px solid rgba(0,113,227,.15)",borderTopColor:"#0071e3",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
          <div style={{fontSize:14,fontWeight:600,color:"#6e6e73"}}>Searching LATAC intelligence feeds{dots}</div>
          <div style={{fontSize:11,color:"#aaa",maxWidth:360,textAlign:"center",lineHeight:1.6}}>
            Querying BleepingComputer · The Hacker News · WeLiveSecurity · SecurityWeek · Dark Reading · SC Magazine · ZDNet · Bloomberg · CSIS and more…
          </div>
        </div>
      ) : error ? (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"70vh",gap:16}}>
          <div style={{fontSize:36}}>⚠️</div>
          <div style={{fontSize:15,fontWeight:600,color:"#dc2626"}}>Failed to load intelligence feed</div>
          <div style={{fontSize:12,color:"#6e6e73",maxWidth:400,textAlign:"center",lineHeight:1.5}}>{error}</div>
          <button onClick={doRefresh} style={{marginTop:8,padding:"10px 24px",borderRadius:20,border:"none",background:"#0071e3",color:"white",fontSize:13,fontWeight:600,cursor:"pointer"}}>Retry</button>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,padding:"20px 28px"}}>
            {cards.map((s,i)=>(
              <div key={i} style={{background:"white",borderRadius:16,padding:"16px 18px",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:s.c,borderRadius:"16px 16px 0 0"}}/>
                <div style={{fontSize:10,fontWeight:600,color:"#6e6e73",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{s.l}</div>
                <div style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:28,fontWeight:700,color:s.c}}>{s.v}</div>
                <div style={{fontSize:10,color:"#6e6e73",marginTop:4}}>{s.s}</div>
              </div>
            ))}
          </div>

          {/* Period */}
          <div style={{display:"flex",gap:4,padding:"10px 28px"}}>
            {PERIODS.map(p=>(
              <button key={p.key} onClick={()=>setPeriod(p.key)} style={{fontFamily:"inherit",fontSize:12,fontWeight:600,padding:"6px 14px",border:period===p.key?"1px solid #1d1d1f":"1px solid rgba(0,0,0,.06)",borderRadius:20,background:period===p.key?"#1d1d1f":"white",color:period===p.key?"white":"#6e6e73",cursor:"pointer",transition:"all .2s"}}>{p.label}</button>
            ))}
          </div>

          {/* FEED */}
          {page==="feed"&&(
            <>
              <div style={{display:"flex",gap:4,padding:"4px 28px 16px"}}>
                {FILTERS.map(f=>(
                  <button key={f.key} onClick={()=>setFilter(f.key)} style={{fontFamily:"inherit",fontSize:12,fontWeight:600,padding:"6px 14px",border:"none",borderRadius:20,background:filter===f.key?"#1d1d1f":"transparent",color:filter===f.key?"white":"#6e6e73",cursor:"pointer"}}>{f.label}</button>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:20,padding:"0 28px 32px"}}>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {filtered.length===0?(
                    <div style={{background:"white",borderRadius:16,padding:"48px",textAlign:"center",color:"#6e6e73",fontSize:13,boxShadow:"0 1px 3px rgba(0,0,0,.08)"}}>No incidents match this period/filter. Try "Live" or "Last Year".</div>
                  ):filtered.map((item,idx)=>(
                    <div key={idx} className="crd" onClick={()=>item.url&&window.open(item.url,"_blank")}
                      style={{background:"white",borderRadius:16,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)",cursor:"pointer",transition:"all .25s",borderLeft:`4px solid ${SEV_COL[item.severity]||"#0071e3"}`,animation:`fadeUp .4s ease ${idx*40}ms both`}}>
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:8}}>
                        <div style={{fontSize:14,fontWeight:600,lineHeight:1.4,flex:1}}>{item.title}</div>
                        <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",letterSpacing:".04em",background:SEV_BG[item.severity],color:SEV_COL[item.severity]}}>{item.severity}</span>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8,fontSize:12,color:"#6e6e73",marginBottom:8,fontWeight:500}}>
                        <span>📰 {item.source}</span><span>{timeAgo(item.date)}</span>
                        {item.flags?.map((f,j)=><span key={j}>{f}</span>)}
                        {item.isGov&&<span style={{color:"#dc2626",fontWeight:600}}>🏛 GOV</span>}
                      </div>
                      <div style={{fontSize:13,lineHeight:1.55,color:"#6e6e73",marginBottom:10}}>{item.summary}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {item.attackTypes?.map((t,j)=><span key={j} style={{fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:6,background:"#f0f0ff",color:"#5856d6"}}>{t}</span>)}
                        {item.sectors?.map((t,j)=><span key={`s${j}`} style={{fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:6,background:t==="GOV"?"#fff0f0":"#f5f5f7",color:t==="GOV"?"#dc2626":"#6e6e73"}}>{t}</span>)}
                      </div>
                      <div style={{fontSize:10,color:"#aaa",marginTop:8}}>📅 {fmtDate(item.date)} · Click to read full article ↗</div>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <div style={{background:"white",borderRadius:16,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#6e6e73",marginBottom:14}}>Affected Countries ({sortC.length})</div>
                    {sortC.map((c,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0"}}>
                        <span style={{fontSize:16}}>{c.flag}</span>
                        <span style={{fontSize:12,fontWeight:600,minWidth:70}}>{c.name}</span>
                        <div style={{flex:1,height:5,background:"#f5f5f7",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,background:"#0071e3",width:`${(c.count/maxCt)*100}%`,transition:"width .8s"}}/></div>
                        <span style={{fontSize:11,fontWeight:600,color:"#6e6e73",minWidth:16,textAlign:"right"}}>{c.count}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{background:"white",borderRadius:16,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#6e6e73",marginBottom:14}}>Attack Types</div>
                    {sortA.map(([t,n],i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",fontSize:12}}>
                        <span style={{fontWeight:500}}>{t}</span>
                        <span style={{fontWeight:700,fontSize:11,background:"#f5f5f7",padding:"2px 8px",borderRadius:4}}>{n}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{background:"white",borderRadius:16,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#6e6e73",marginBottom:10}}>About this feed</div>
                    <div style={{fontSize:11,color:"#6e6e73",lineHeight:1.6}}>Live intelligence powered by Claude AI + web search. Queries BleepingComputer, The Hacker News, WeLiveSecurity, SecurityWeek, Dark Reading, SC Magazine, ZDNet, Bloomberg, CSIS and more.</div>
                    <div style={{fontSize:10,color:"#aaa",marginTop:6}}>Updated: {new Date().toLocaleString()}</div>
                    <button onClick={doRefresh} style={{marginTop:10,width:"100%",padding:"8px",borderRadius:8,border:"1px solid rgba(0,0,0,.06)",background:"#f5f5f7",fontSize:12,fontWeight:600,color:"#0071e3",cursor:"pointer",fontFamily:"inherit"}}>🔄 Refresh Feed</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* MAP */}
          {page==="map"&&(
            <div style={{padding:"16px 28px 32px"}}>
              <ThreatMap incidents={incidents} period={period} geoData={geoData} />
            </div>
          )}

          {/* HISTORICAL */}
          {page==="hist"&&(
            <div style={{padding:"16px 28px 32px",maxWidth:860}}>
              <div style={{background:"white",borderRadius:16,padding:"24px",boxShadow:"0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)"}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>All {incidents.length} Incidents — Chronological</div>
                {incidents.map((item,i)=>(
                  <div key={i} onClick={()=>item.url&&window.open(item.url,"_blank")}
                    style={{padding:"14px 0",borderBottom:i<incidents.length-1?"1px solid rgba(0,0,0,.06)":"none",cursor:"pointer"}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                      <div style={{fontSize:11,color:"#6e6e73",minWidth:80,fontWeight:500,paddingTop:2}}>📅 {fmtDate(item.date)}</div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:4}}>
                          <div style={{fontSize:13,fontWeight:600,lineHeight:1.4,flex:1}}>{item.title}</div>
                          <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",padding:"2px 8px",borderRadius:10,background:SEV_BG[item.severity],color:SEV_COL[item.severity]}}>{item.severity}</span>
                        </div>
                        <div style={{fontSize:11,color:"#6e6e73",lineHeight:1.5,marginBottom:6}}>{item.summary}</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
                          {item.flags?.map((f,j)=><span key={j}>{f}</span>)}
                          <span style={{fontSize:10,color:"#6e6e73"}}>· {item.source}</span>
                          {item.isGov&&<span style={{fontSize:10,color:"#dc2626",fontWeight:600}}>· 🏛 GOV</span>}
                          <span style={{fontSize:10,color:"#aaa"}}>· {timeAgo(item.date)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
