import { useState, useMemo, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch
} from "firebase/firestore";
import {
  APP_NAME, GROCERY_STORE_NAME,
  CATEGORIES, STORE_SECTIONS, TARGET_CATEGORIES,
  classifyTarget, LOWES_CATEGORIES, classifyLowes,
  classifyIngredient,
  toShoppingText, combineItems,
  PRODUCE_ORDER, produceSubSort
} from './config.js';

// ── M3 Tonal Palette (purple seed #6750A4) ──────────────────────────────────
const M3 = {
  primary:              "#6750A4",
  onPrimary:            "#FFFFFF",
  primaryContainer:     "#EADDFF",
  onPrimaryContainer:   "#21005D",
  secondary:            "#625B71",
  onSecondary:          "#FFFFFF",
  secondaryContainer:   "#E8DEF8",
  onSecondaryContainer: "#1D192B",
  surface:              "#FFFBFE",
  surfaceVariant:       "#E7E0EC",
  onSurface:            "#1C1B1F",
  onSurfaceVariant:     "#49454F",
  outline:              "#79747E",
  outlineVariant:       "#CAC4D0",
  background:           "#FFFBFE",
  error:                "#B3261E",
  onError:              "#FFFFFF",
  errorContainer:       "#F9DEDC",
  onErrorContainer:     "#410E0B",
  success:              "#386A20",
  successContainer:     "#C3EFAC",
};
const font = "'Google Sans', 'Trebuchet MS', Helvetica, sans-serif";

// ── Store definitions ────────────────────────────────────────────────────────
const STORES = [
  { id:"mb",     label:"Market Basket", emoji:"🧺", color:"#C8102E", dark:"#A00D24" },
  { id:"target", label:"Target",        emoji:"🎯", color:"#CC0000", dark:"#990000" },
  { id:"lowes",  label:"Lowe's",        emoji:"🔨", color:"#004990", dark:"#003370" },
];

// ── Shared input style ───────────────────────────────────────────────────────
const inp = {
  width:"100%", padding:"10px 12px",
  border:`1px solid ${M3.outlineVariant}`, borderRadius:8,
  fontSize:14, fontFamily:font,
  background:M3.surface, color:M3.onSurface,
  boxSizing:"border-box", outline:"none",
};

// ── Timer helpers ────────────────────────────────────────────────────────────
const extractTimerSeconds = (text) => {
  const t = text.toLowerCase(); let total = 0;
  const rm = t.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*minutes?/);
  if (rm) { total += parseInt(rm[2]) * 60; }
  const rh = t.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*hours?/);
  if (rh) { total += parseInt(rh[2]) * 3600; }
  if (rm || rh) return total || null;
  const hrs = t.match(/(\d+(?:\.\d+)?)\s*hours?/);
  const mins = t.match(/(\d+(?:\.\d+)?)\s*minutes?/);
  const secs = t.match(/(\d+)\s*seconds?/);
  if (hrs) total += parseFloat(hrs[1]) * 3600;
  if (mins) total += parseFloat(mins[1]) * 60;
  if (secs) total += parseInt(secs[1]);
  return total > 0 ? Math.round(total) : null;
};
const fmtTime = (s) => {
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  if (h>0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
};
const reqNotif = async () => { try { if ("Notification" in window && Notification.permission==="default") await Notification.requestPermission(); } catch(e) {} };
const sendNotif = (title, body) => { try { if ("Notification" in window && Notification.permission==="granted") new Notification(title,{body}); } catch(e) {} };

// ── StepTimer ────────────────────────────────────────────────────────────────
function StepTimer({ seconds, stepText }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef(null);
  useEffect(() => { setRemaining(seconds); setRunning(false); setDone(false); }, [seconds]);
  useEffect(() => {
    if (running) {
      reqNotif();
      ref.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 1) { clearInterval(ref.current); setRunning(false); setDone(true); try { sendNotif("Timer done!", stepText?.slice(0,60)); } catch(e) {} return 0; }
          return r - 1;
        });
      }, 1000);
    } else clearInterval(ref.current);
    return () => clearInterval(ref.current);
  }, [running]);
  const pct = Math.round(((seconds-remaining)/seconds)*100);
  const reset = (e) => { e.stopPropagation(); setRemaining(seconds); setRunning(false); setDone(false); };
  const bg = done ? M3.successContainer : running ? M3.primaryContainer : M3.surfaceVariant;
  const fg = done ? M3.success : M3.primary;
  return (
    <div onClick={e=>{e.stopPropagation();if(done){reset(e);}else{setRunning(r=>!r);}}}
      style={{display:"inline-flex",alignItems:"center",gap:8,marginTop:8,background:bg,borderRadius:20,padding:"5px 12px 5px 8px",cursor:"pointer",border:`1px solid ${done?M3.success:M3.outline}`}}>
      <svg width="22" height="22" viewBox="0 0 22 22" style={{flexShrink:0}}>
        <circle cx="11" cy="11" r="9" fill="none" stroke={M3.outlineVariant} strokeWidth="2.5"/>
        {!done&&<circle cx="11" cy="11" r="9" fill="none" stroke={running?M3.primary:M3.secondary} strokeWidth="2.5" strokeDasharray={`${2*Math.PI*9}`} strokeDashoffset={`${2*Math.PI*9*(1-pct/100)}`} strokeLinecap="round" transform="rotate(-90 11 11)" style={{transition:"stroke-dashoffset 0.9s linear"}}/>}
        <text x="11" y="15" textAnchor="middle" fontSize="8" fontWeight="700" fill={fg}>{done?"✓":running?"▐▐":"▶"}</text>
      </svg>
      <span style={{fontSize:13,fontWeight:500,color:fg,fontVariantNumeric:"tabular-nums",minWidth:38,textAlign:"center"}}>{done?"Done!":fmtTime(remaining)}</span>
      {(running||done)&&<span onClick={reset} style={{fontSize:11,color:fg,opacity:0.7}}>↺</span>}
    </div>
  );
}

// ── parseRecipes ─────────────────────────────────────────────────────────────
const parseRecipes = (text) => {
  const blocks = text.split(/\n{2,}(?=[A-Z])/);
  return blocks.map((block,i) => {
    const lines = block.trim().split("\n").filter(l=>l.trim());
    if (!lines.length) return null;
    const title = lines[0].trim();
    let category="Other", servings=4, ingredients=[], instructions=[], section=null;
    for (let j=1; j<lines.length; j++) {
      const l=lines[j].trim(), ll=l.toLowerCase();
      if (ll.startsWith("category:")) { category=l.split(":")[1]?.trim()||"Other"; section=null; continue; }
      if (ll.startsWith("servings:")||ll.startsWith("serves:")) { servings=parseInt(l.split(":")[1])||4; section=null; continue; }
      if (ll.match(/^ingredients?:?\s*$/)) { section="ing"; continue; }
      if (ll.match(/^(instructions?|directions?|method|steps?):?\s*$/)) { section="inst"; continue; }
      if (section==="ing") { const c=l.replace(/^[-*•]\s*/,"").trim(); if(c) ingredients.push(c); }
      else if (section==="inst") { const c=l.replace(/^\d+[.)]\s*/,"").trim(); if(c) instructions.push(c); }
    }
    if (!ingredients.length && !instructions.length) return null;
    const validCat = CATEGORIES.includes(category)?category:"Other";
    return { id:`seed_${i}`, title, category:validCat, baseServings:servings, servings, ingredients, instructions, favorite:false, notes:"", storage:"" };
  }).filter(Boolean);
};

const scaleIngredient = (line, ratio) => line.replace(/(\d+\.?\d*\/?\d*)/g, match => {
  if (match.includes("/")) { const [n,d]=match.split("/").map(Number); const v=(n/d)*ratio; return v%1===0?v.toString():v.toFixed(2).replace(/\.?0+$/,""); }
  const v=parseFloat(match)*ratio; if(v%1===0) return v.toString(); return v.toFixed(2).replace(/\.?0+$/,"");
});

// ── M3 Bottom Navigation Bar ─────────────────────────────────────────────────
function BottomNav({ view, setView, totalItems, M3, font, photoInputRef }) {
  const tabs = [
    {
      id: "recipes",
      label: "Recipes",
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M4 6h14M4 11h14M4 16h9" stroke={active ? M3.primary : M3.onSurfaceVariant} strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "storeSelect",
      label: "Shopping",
      badge: totalItems,
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M2 2h3l2 10h10l2-7H6" stroke={active ? M3.primary : M3.onSurfaceVariant} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="9" cy="17" r="1.5" fill={active ? M3.primary : M3.onSurfaceVariant}/>
          <circle cx="16" cy="17" r="1.5" fill={active ? M3.primary : M3.onSurfaceVariant}/>
        </svg>
      ),
    },
    {
      id: "import",
      label: "Import",
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="8.5" stroke={active ? M3.primary : M3.onSurfaceVariant} strokeWidth="1.6"/>
          <path d="M11 7v8M8 13l3 3 3-3" stroke={active ? M3.primary : M3.onSurfaceVariant} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
  ];

  const activeTab = ["recipes"].includes(view) ? "recipes"
    : ["storeSelect","shopping"].includes(view) ? "storeSelect"
    : view === "import" ? "import"
    : "recipes";

  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0,
      background:M3.surface,
      borderTop:`0.5px solid ${M3.outlineVariant}`,
      display:"flex", zIndex:200,
      paddingBottom:"env(safe-area-inset-bottom, 0px)",
    }}>
      {tabs.map(tab => {
        const active = activeTab === tab.id;
        return (
          <button key={tab.id} onClick={()=>setView(tab.id)}
            style={{flex:1,background:"none",border:"none",cursor:"pointer",padding:"10px 0 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontFamily:font,position:"relative"}}>
            {/* Active pill indicator */}
            <div style={{width:64,height:32,borderRadius:16,background:active?M3.secondaryContainer:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"background 0.15s",position:"relative"}}>
              {tab.icon(active)}
              {tab.badge>0&&(
                <span style={{position:"absolute",top:-2,right:8,background:M3.error,color:M3.onError,borderRadius:"50%",fontSize:9,width:15,height:15,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>
                  {tab.badge>99?"99+":tab.badge}
                </span>
              )}
            </div>
            <span style={{fontSize:11,color:active?M3.primary:M3.onSurfaceVariant,fontWeight:active?500:400}}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── State ──
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sortAZ, setSortAZ] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("recipes"); // "recipes"|"storeSelect"|"shopping"
  const [storeTab, setStoreTab] = useState("mb");

  // import
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [photoImporting, setPhotoImporting] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [urlImportValue, setUrlImportValue] = useState("");
  const [urlImporting, setUrlImporting] = useState(false);
  const [urlImportError, setUrlImportError] = useState(null);
  const photoInputRef = useRef(null);

  // edit
  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // MB shopping
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [checkedItems, setCheckedItems] = useState(new Set());
  const [manualItems, setManualItems] = useState([]);
  const [removedKeys, setRemovedKeys] = useState(new Set());
  const [manualInput, setManualInput] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [editingText, setEditingText] = useState("");
  const shoppingLoaded = useRef(false);

  // Target
  const [targetItems, setTargetItems] = useState([]);
  const [targetChecked, setTargetChecked] = useState(new Set());
  const [targetInput, setTargetInput] = useState("");
  const [targetQty, setTargetQty] = useState("");
  const [targetCountdown, setTargetCountdown] = useState(null);
  const targetTimerRef = useRef(null);
  const targetResetAtRef = useRef(null);

  // Lowe's
  const [lowesItems, setLowesItems] = useState([]);
  const [lowesChecked, setLowesChecked] = useState(new Set());
  const [lowesInput, setLowesInput] = useState("");
  const [lowesQty, setLowesQty] = useState("");
  const [lowesCountdown, setLowesCountdown] = useState(null);
  const lowesTimerRef = useRef(null);
  const lowesResetAtRef = useRef(null);

  // wake lock
  const [wakeLock, setWakeLock] = useState(null);
  const [wakeActive, setWakeActive] = useState(false);

  // ── Effects ──
  useEffect(() => { window.scrollTo(0,0); }, []);

  useEffect(() => {
    const run = async () => {
      const snap = await getDocs(collection(db,"recipes"));
      const batch = writeBatch(db); let need = false;
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.notes===undefined||data.storage===undefined) { batch.update(doc(db,"recipes",d.id),{notes:data.notes??"",storage:data.storage??""}); need=true; }
      });
      if (need) await batch.commit();
    };
    run();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db,"recipes"), (snap) => {
      setRecipes(snap.docs.map(d=>({id:d.id,...d.data(),servings:d.data().servings||d.data().baseServings})));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,"app","shopping"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCheckedIds(new Set(data.checkedIds||[]));
        setCheckedItems(new Set(data.checkedItems||[]));
        setManualItems(data.manualItems||[]);
        setRemovedKeys(new Set(data.removedKeys||[]));
      }
      shoppingLoaded.current = true;
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,"app","target"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setTargetItems(data.items||[]); setTargetChecked(new Set(data.checked||[]));
        if (data.resetAt && !targetTimerRef.current) {
          const rem = data.resetAt - Date.now();
          if (rem<=0) { resetTarget(); } else {
            targetResetAtRef.current = data.resetAt;
            targetTimerRef.current = setInterval(() => {
              const r = data.resetAt - Date.now();
              if (r<=0) { resetTarget(); return; }
              const m=Math.floor(r/60000), s=Math.floor((r%60000)/1000);
              setTargetCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
            }, 1000);
          }
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,"app","lowes"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLowesItems(data.items||[]); setLowesChecked(new Set(data.checked||[]));
        if (data.resetAt && !lowesTimerRef.current) {
          const rem = data.resetAt - Date.now();
          if (rem<=0) { resetLowes(); } else {
            lowesResetAtRef.current = data.resetAt;
            lowesTimerRef.current = setInterval(() => {
              const r = data.resetAt - Date.now();
              if (rem<=0) { resetLowes(); return; }
              const m=Math.floor(r/60000), s=Math.floor((r%60000)/1000);
              setLowesCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
            }, 1000);
          }
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const tt=targetItems.length, tc=targetItems.filter(i=>targetChecked.has(i.key)).length;
    if (tt>0 && tc===tt) {
      if (targetTimerRef.current) return;
      const end = targetResetAtRef.current || Date.now()+60*60*1000;
      targetResetAtRef.current = end;
      setDoc(doc(db,"app","target"),{resetAt:end},{merge:true});
      targetTimerRef.current = setInterval(() => {
        const rem=end-Date.now(); if(rem<=0){resetTarget();return;}
        const m=Math.floor(rem/60000),s=Math.floor((rem%60000)/1000);
        setTargetCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
      }, 1000);
    } else {
      if(targetTimerRef.current){clearInterval(targetTimerRef.current);targetTimerRef.current=null;}
      targetResetAtRef.current=null; setTargetCountdown(null);
    }
  }, [targetChecked, targetItems]);

  useEffect(() => {
    const lt=lowesItems.length, lc=lowesItems.filter(i=>lowesChecked.has(i.key)).length;
    if (lt>0 && lc===lt) {
      if (lowesTimerRef.current) return;
      const end = lowesResetAtRef.current || Date.now()+60*60*1000;
      lowesResetAtRef.current = end;
      setDoc(doc(db,"app","lowes"),{resetAt:end},{merge:true});
      lowesTimerRef.current = setInterval(() => {
        const rem=end-Date.now(); if(rem<=0){resetLowes();return;}
        const m=Math.floor(rem/60000),s=Math.floor((rem%60000)/1000);
        setLowesCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
      }, 1000);
    } else {
      if(lowesTimerRef.current){clearInterval(lowesTimerRef.current);lowesTimerRef.current=null;}
      lowesResetAtRef.current=null; setLowesCountdown(null);
    }
  }, [lowesChecked, lowesItems]);

  // ── Helpers ──
  const saveShop = (u) => setDoc(doc(db,"app","shopping"),u,{merge:true});

  const allShoppingItems = useMemo(() => {
    const items=[];
    recipes.filter(r=>checkedIds.has(r.id)).forEach(r => {
      const ratio=r.servings/r.baseServings;
      r.ingredients.forEach(ing => {
        const scaled=ratio!==1?scaleIngredient(ing,ratio):ing;
        const lower=ing.toLowerCase();
        if (lower.includes("salt and pepper")||lower.includes("salt & pepper")) {
          ["salt","pepper"].forEach(item => { const key=`r${r.id}::${item}`; if(!removedKeys.has(key)) items.push({key,text:item,recipe:r.title,sectionKey:classifyIngredient(item),manual:false}); });
        } else {
          const key=`r${r.id}::${ing}`; if(!removedKeys.has(key)) items.push({key,text:toShoppingText(scaled),recipe:r.title,sectionKey:classifyIngredient(ing),manual:false});
        }
      });
    });
    manualItems.forEach(m=>{ if(!removedKeys.has(m.key)) items.push({...m,sectionKey:classifyIngredient(m.text),manual:true}); });
    return items;
  }, [checkedIds,recipes,manualItems,removedKeys]);

  const grouped = useMemo(() => {
    const g={}; STORE_SECTIONS.forEach(s=>g[s.key]=[]);
    allShoppingItems.forEach(item=>{(g[item.sectionKey]||g["kitchen"]).push(item);});
    const c={}; Object.keys(g).forEach(k=>{const it=combineItems(g[k]);c[k]=k==="produce"?produceSubSort(it):it;}); return c;
  }, [allShoppingItems]);

  const total=allShoppingItems.length;
  const checked=allShoppingItems.filter(i=>checkedItems.has(i.key)).length;
  const pct=total>0?Math.round((checked/total)*100):0;
  const activeSections=STORE_SECTIONS.filter(s=>grouped[s.key]?.some(i=>!checkedItems.has(i.key)));
  const completedItems=allShoppingItems.filter(i=>checkedItems.has(i.key));

  const resetShopping=()=>{ const e={checkedIds:[],checkedItems:[],manualItems:[],removedKeys:[],resetAt:null}; setCheckedIds(new Set());setCheckedItems(new Set());setManualItems([]);setRemovedKeys(new Set());setEditingKey(null);saveShop(e); };
  const toggleCheck=(id,e)=>{ e.stopPropagation(); setCheckedIds(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);saveShop({checkedIds:[...n]});return n;}); };
  const toggleItem=(key)=>{ setCheckedItems(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);saveShop({checkedItems:[...n]});return n;}); };
  const removeItem=(key)=>{ setRemovedKeys(p=>{const n=new Set(p);n.add(key);saveShop({removedKeys:[...n]});return n;}); setCheckedItems(p=>{const n=new Set(p);n.delete(key);saveShop({checkedItems:[...n]});return n;}); };
  const startEdit=(key,text,e)=>{e.stopPropagation();setEditingKey(key);setEditingText(text);};
  const saveEdit=(key)=>{ if(!editingText.trim()){setEditingKey(null);return;} const u=manualItems.map(m=>m.key===key?{...m,text:editingText.trim()}:m); setManualItems(u);saveShop({manualItems:u});setEditingKey(null); };
  const addManual=()=>{ if(!manualInput.trim())return; const qty=parseInt(manualQty)||1; const text=qty>1?`${qty} ${manualInput.trim()}`:manualInput.trim(); const item={key:`m${Date.now()}`,text,recipe:"Added manually",manual:true}; const u=[...manualItems,item]; setManualItems(u);saveShop({manualItems:u});setManualInput("");setManualQty(""); };

  const addTargetItem=()=>{ if(!targetInput.trim())return; const qty=parseInt(targetQty)||1; const text=qty>1?`${qty} ${targetInput.trim()}`:targetInput.trim(); const item={key:`t${Date.now()}`,text,category:classifyTarget(targetInput.trim())}; const u=[...targetItems,item]; setTargetItems(u); setDoc(doc(db,"app","target"),{items:u,checked:[...targetChecked]},{merge:true}); setTargetInput("");setTargetQty(""); };
  const toggleTargetItem=(key)=>{ setTargetChecked(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);setDoc(doc(db,"app","target"),{checked:[...n]},{merge:true});return n;}); };
  const removeTargetItem=(key)=>{ const u=targetItems.filter(i=>i.key!==key); setTargetItems(u); setTargetChecked(p=>{const n=new Set(p);n.delete(key);return n;}); setDoc(doc(db,"app","target"),{items:u,checked:[...targetChecked].filter(k=>k!==key)},{merge:true}); };
  const resetTarget=()=>{ setTargetItems([]);setTargetChecked(new Set());setTargetCountdown(null); if(targetTimerRef.current){clearInterval(targetTimerRef.current);targetTimerRef.current=null;} targetResetAtRef.current=null; setDoc(doc(db,"app","target"),{items:[],checked:[],resetAt:null}); };

  const addLowesItem=()=>{ if(!lowesInput.trim())return; const qty=parseInt(lowesQty)||1; const text=qty>1?`${qty} ${lowesInput.trim()}`:lowesInput.trim(); const item={key:`l${Date.now()}`,text,category:classifyLowes(lowesInput.trim())}; const u=[...lowesItems,item]; setLowesItems(u); setDoc(doc(db,"app","lowes"),{items:u,checked:[...lowesChecked]},{merge:true}); setLowesInput("");setLowesQty(""); };
  const toggleLowesItem=(key)=>{ setLowesChecked(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);setDoc(doc(db,"app","lowes"),{checked:[...n]},{merge:true});return n;}); };
  const removeLowesItem=(key)=>{ const u=lowesItems.filter(i=>i.key!==key); setLowesItems(u); setLowesChecked(p=>{const n=new Set(p);n.delete(key);return n;}); setDoc(doc(db,"app","lowes"),{items:u,checked:[...lowesChecked].filter(k=>k!==key)},{merge:true}); };
  const resetLowes=()=>{ setLowesItems([]);setLowesChecked(new Set());setLowesCountdown(null); if(lowesTimerRef.current){clearInterval(lowesTimerRef.current);lowesTimerRef.current=null;} lowesResetAtRef.current=null; setDoc(doc(db,"app","lowes"),{items:[],checked:[],resetAt:null}); };

  const toggleFav=async(id,e)=>{ e&&e.stopPropagation(); const r=recipes.find(r=>r.id===id); if(!r)return; await updateDoc(doc(db,"recipes",id),{favorite:!r.favorite}); };
  const setServings=(id,val)=>{ const v=Math.max(1,val); setRecipes(rs=>rs.map(r=>r.id===id?{...r,servings:v}:r)); updateDoc(doc(db,"recipes",id),{servings:v}); };
  const toggleWakeLock=async()=>{ if(wakeActive&&wakeLock){await wakeLock.release();setWakeLock(null);setWakeActive(false);} else{try{if("wakeLock" in navigator){const lock=await navigator.wakeLock.request("screen");setWakeLock(lock);setWakeActive(true);lock.addEventListener("release",()=>{setWakeActive(false);setWakeLock(null);});}}catch(e){}} };

  const saveRecipesToFirestore=async(nr)=>{ const batch=writeBatch(db); nr.forEach((r,i)=>{const id=`recipe_${Date.now()}_${i}`;batch.set(doc(db,"recipes",id),{title:r.title,category:r.category,baseServings:r.baseServings,servings:r.servings,ingredients:r.ingredients,instructions:r.instructions,favorite:false,notes:"",storage:""});}); await batch.commit(); };
  const RECIPE_PROMPT=`Extract this recipe and format it exactly like this:\n\nRecipe Title\nCategory: Mains\nServings: 4\nIngredients:\n- ingredient 1\n- ingredient 2\nInstructions:\n1. Step one\n2. Step two\n\nUse one of these categories: Appetizers, Italian, Soups & Stews, Mains, Meats, Fish & Seafood, Vegetables, Sides, Desserts, Breads & Breakfast, Drinks, Other.\nReturn ONLY the formatted recipe, nothing else.`;

  const handleImport=async()=>{ if(!importText.trim())return; const nr=parseRecipes(importText); if(nr.length){await saveRecipesToFirestore(nr);setImportText("");setShowImport(false);} };

  const handlePhotoImport=async(e)=>{ const file=e.target.files?.[0]; if(!file)return; setPhotoImporting(true);setPhotoError(null);setShowPhotoImport(true); try{ const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Failed to read file"));r.readAsDataURL(file);}); const mediaType=file.type||"image/jpeg"; const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-opus-4-5",max_tokens:2000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:base64}},{type:"text",text:RECIPE_PROMPT}]}]})}); if(!response.ok)throw new Error(`API error: ${response.status}`); const data=await response.json(); const recipeText=data.content?.[0]?.text; if(!recipeText)throw new Error("No recipe text returned"); const nr=parseRecipes(recipeText); if(!nr.length)throw new Error("Could not parse recipe from image"); await saveRecipesToFirestore(nr); setShowPhotoImport(false);setPhotoImporting(false); if(photoInputRef.current)photoInputRef.current.value=""; }catch(err){setPhotoError(err.message||"Something went wrong.");setPhotoImporting(false);} };

  const handleUrlImport=async()=>{ if(!urlImportValue.trim())return; setUrlImporting(true);setUrlImportError(null); try{ const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-opus-4-5",max_tokens:2000,tools:[{type:"web_search_20250305",name:"web_search"}],messages:[{role:"user",content:`Fetch the recipe from this URL and extract it: ${urlImportValue.trim()}\n\n${RECIPE_PROMPT}`}]})}); if(!response.ok)throw new Error(`API error: ${response.status}`); const data=await response.json(); const textBlock=data.content?.find(b=>b.type==="text"); const recipeText=textBlock?.text; if(!recipeText)throw new Error("No recipe text returned"); const nr=parseRecipes(recipeText); if(!nr.length)throw new Error("Could not parse a recipe from that URL. Try the text import instead."); await saveRecipesToFirestore(nr); setShowUrlImport(false);setUrlImportValue("");setUrlImporting(false); }catch(err){setUrlImportError(err.message||"Something went wrong.");setUrlImporting(false);} };

  const startEditRecipe=(r)=>{ setEditDraft({title:r.title,category:r.category,servings:r.servings,baseServings:r.baseServings,ingredients:r.ingredients.join("\n"),instructions:r.instructions.join("\n"),notes:r.notes||"",storage:r.storage||""}); setEditingRecipeId(r.id); };
  const saveEditRecipe=async(id)=>{ await updateDoc(doc(db,"recipes",id),{title:editDraft.title.trim(),category:editDraft.category,servings:Math.max(1,parseInt(editDraft.servings)||1),baseServings:Math.max(1,parseInt(editDraft.baseServings)||parseInt(editDraft.servings)||1),ingredients:editDraft.ingredients.split("\n").map(l=>l.replace(/^[-*•]\s*/,"").trim()).filter(Boolean),instructions:editDraft.instructions.split("\n").map(l=>l.replace(/^\d+[.)]\s*/,"").trim()).filter(Boolean),notes:editDraft.notes||"",storage:editDraft.storage||""}); setEditingRecipeId(null);setEditDraft(null); };
  const cancelEditRecipe=()=>{setEditingRecipeId(null);setEditDraft(null);};
  const deleteRecipe=async(id)=>{await deleteDoc(doc(db,"recipes",id));setSelectedId(null);setConfirmDelete(false);};

  const filtered=useMemo(()=>{ let list=recipes; if(activeTab==="Favorites")list=list.filter(r=>r.favorite); else if(activeTab!=="All")list=list.filter(r=>r.category===activeTab); if(search.trim()){const q=search.toLowerCase();list=list.filter(r=>r.title.toLowerCase().includes(q)||r.ingredients.some(i=>i.toLowerCase().includes(q)));} return [...list].sort((a,b)=>sortAZ?a.title.localeCompare(b.title):b.title.localeCompare(a.title)); },[recipes,activeTab,search,sortAZ]);

  const selected=recipes.find(r=>r.id===selectedId);
  const mbCount=total, targetCount=targetItems.length, lowesCount=lowesItems.length;
  const totalItems=mbCount+targetCount+lowesCount;

  // ── Back arrow ──
  const BackBtn = ({to, label}) => (
    <button onClick={()=>setView(to)} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke={M3.primaryContainer} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <span style={{fontSize:13,color:M3.primaryContainer}}>{label}</span>
    </button>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // LOADING
  if (loading) return (
    <div style={{fontFamily:font,background:M3.background,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:48,height:48,borderRadius:12,background:M3.primaryContainer,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke={M3.primary} strokeWidth="2" strokeLinecap="round"/></svg>
        </div>
        <div style={{fontSize:16,color:M3.onSurfaceVariant}}>{`Loading ${APP_NAME}…`}</div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // STORE SELECTOR
  if (view==="storeSelect") return (
    <div style={{fontFamily:font,background:M3.background,minHeight:"100vh",color:M3.onSurface,paddingBottom:90}}>
      <div style={{background:M3.primary,padding:"14px 16px 20px"}}>
        <BackBtn to="recipes" label="Recipes"/>
        <div style={{fontSize:11,color:`${M3.onPrimary}99`,letterSpacing:1.2,marginBottom:3}}>Shopping</div>
        <div style={{fontSize:22,fontWeight:500,color:M3.onPrimary}}>Choose a store</div>
      </div>
      <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
        {STORES.map(store => {
          const count=store.id==="mb"?mbCount:store.id==="target"?targetCount:lowesCount;
          return (
            <div key={store.id} onClick={()=>{setStoreTab(store.id);setView("shopping");}}
              style={{background:M3.surface,border:`0.5px solid ${M3.outlineVariant}`,borderRadius:16,padding:"16px 18px",display:"flex",alignItems:"center",gap:14,cursor:"pointer"}}>
              <div style={{width:48,height:48,borderRadius:12,background:store.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>{store.emoji}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:500,color:M3.onSurface}}>{store.label}</div>
                <div style={{fontSize:13,color:M3.onSurfaceVariant,marginTop:2}}>{count>0?`${count} item${count!==1?"s":""}`:"No items"}</div>
              </div>
              {count>0&&<div style={{background:store.color,color:"white",borderRadius:20,padding:"3px 10px",fontSize:12,fontWeight:700}}>{count}</div>}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke={M3.outline} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          );
        })}
      </div>
      <BottomNav view={view} setView={setView} totalItems={totalItems} M3={M3} font={font} photoInputRef={photoInputRef}/>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // SHOPPING VIEW
  if (view==="shopping") {
    const store=STORES.find(s=>s.id===storeTab);

    const targetGrouped={}; TARGET_CATEGORIES.forEach(c=>targetGrouped[c.key]=[]); targetItems.forEach(item=>{(targetGrouped[item.category]||targetGrouped["other"]).push(item);});
    const targetActiveCats=TARGET_CATEGORIES.filter(c=>targetGrouped[c.key]?.length>0);
    const targetTotal=targetItems.length, targetCC=targetItems.filter(i=>targetChecked.has(i.key)).length;
    const targetPct=targetTotal>0?Math.round((targetCC/targetTotal)*100):0;

    const lowesGrouped={}; LOWES_CATEGORIES.forEach(c=>lowesGrouped[c.key]=[]); lowesItems.forEach(item=>{(lowesGrouped[item.category]||lowesGrouped["other"]).push(item);});
    const lowesActiveCats=LOWES_CATEGORIES.filter(c=>lowesGrouped[c.key]?.length>0);
    const lowesTotal=lowesItems.length, lowesCC=lowesItems.filter(i=>lowesChecked.has(i.key)).length;
    const lowesPct=lowesTotal>0?Math.round((lowesCC/lowesTotal)*100):0;

    const cTotal=storeTab==="mb"?total:storeTab==="target"?targetTotal:lowesTotal;
    const cChecked=storeTab==="mb"?checked:storeTab==="target"?targetCC:lowesCC;
    const cPct=storeTab==="mb"?pct:storeTab==="target"?targetPct:lowesPct;

    const GenericItem=({item,done,onToggle,onRemove})=>(
      <div style={{background:M3.surface,borderRadius:12,border:`0.5px solid ${M3.outlineVariant}`,padding:"10px 12px",marginBottom:4,display:"flex",alignItems:"center",gap:10,opacity:done?0.5:1}}>
        <div onClick={()=>onToggle(item.key)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${done?store.color:M3.outline}`,background:done?store.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer"}}>
          {done&&<svg width="10" height="10" viewBox="0 0 10 10"><polyline points="2,5 4,7 8,3" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
        <div onClick={()=>onToggle(item.key)} style={{flex:1,fontSize:14,textDecoration:done?"line-through":"none",color:done?M3.onSurfaceVariant:M3.onSurface,cursor:"pointer"}}>{item.text}</div>
        <span onClick={()=>onRemove(item.key)} style={{fontSize:13,color:M3.outlineVariant,cursor:"pointer",padding:"2px 6px"}}>✕</span>
      </div>
    );

    const addFn=storeTab==="mb"?addManual:storeTab==="target"?addTargetItem:addLowesItem;
    const inputVal=storeTab==="mb"?manualInput:storeTab==="target"?targetInput:lowesInput;
    const setInputVal=storeTab==="mb"?setManualInput:storeTab==="target"?setTargetInput:setLowesInput;
    const qtyVal=storeTab==="mb"?manualQty:storeTab==="target"?targetQty:lowesQty;
    const setQtyVal=storeTab==="mb"?setManualQty:storeTab==="target"?setTargetQty:setLowesQty;
    const resetFn=storeTab==="mb"?resetShopping:storeTab==="target"?resetTarget:resetLowes;
    const countdown=storeTab==="target"?targetCountdown:storeTab==="lowes"?lowesCountdown:null;

    return (
      <div style={{fontFamily:font,background:M3.background,minHeight:"100vh",color:M3.onSurface,paddingBottom:90}}>
        <div style={{background:M3.primary,padding:"14px 16px 14px"}}>
          <BackBtn to="storeSelect" label="Stores"/>
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:11,color:`${M3.onPrimary}99`,letterSpacing:1.2,marginBottom:2}}>{store.label}</div>
              <div style={{fontSize:22,fontWeight:500,color:M3.onPrimary}}>Shopping list</div>
            </div>
            <button onClick={resetFn} style={{background:"transparent",color:M3.primaryContainer,border:`1px solid ${M3.primaryContainer}`,borderRadius:20,padding:"5px 14px",fontSize:12,cursor:"pointer",fontFamily:font,fontWeight:500}}>Reset</button>
          </div>
          <div style={{marginTop:12,background:`${M3.onPrimary}30`,borderRadius:4,height:4,overflow:"hidden"}}>
            <div style={{background:cPct===100?M3.successContainer:M3.onPrimary,width:cPct+"%",height:4,borderRadius:4,transition:"width 0.4s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
            <span style={{fontSize:11,color:`${M3.onPrimary}AA`}}>{cChecked} of {cTotal} items</span>
            <span style={{fontSize:11,color:`${M3.onPrimary}AA`}}>{cPct}%{countdown?` · ${countdown}`:""}</span>
          </div>
        </div>

        {/* Add item row */}
        <div style={{padding:"12px 14px 6px"}}>
          <div style={{display:"flex",gap:8}}>
            <input type="number" min={1} max={99} value={qtyVal} onChange={e=>setQtyVal(e.target.value)} placeholder="1"
              style={{width:52,padding:"9px 6px",borderRadius:8,border:`1px solid ${M3.outlineVariant}`,fontSize:14,fontFamily:font,background:M3.surface,textAlign:"center",color:M3.onSurface}}/>
            <input value={inputVal} onChange={e=>setInputVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addFn()} placeholder="Add item…"
              style={{flex:1,padding:"9px 14px",borderRadius:8,border:`1px solid ${M3.outlineVariant}`,fontSize:14,fontFamily:font,background:M3.surface,color:M3.onSurface,outline:"none"}}/>
            <button onClick={addFn} style={{background:M3.primary,color:M3.onPrimary,border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,cursor:"pointer",fontWeight:500,fontFamily:font}}>Add</button>
          </div>
          {storeTab==="mb"&&checkedIds.size>0&&<div style={{fontSize:12,color:M3.onSurfaceVariant,marginTop:6,fontStyle:"italic"}}>Recipes: {recipes.filter(r=>checkedIds.has(r.id)).map(r=>r.title).join(", ")}</div>}
        </div>

        {/* MB sections */}
        {storeTab==="mb"&&(total===0?(
          <p style={{textAlign:"center",padding:"40px 20px",color:M3.onSurfaceVariant,fontStyle:"italic"}}>No items yet. Check recipes or add items above.</p>
        ):(
          <div style={{padding:"4px 0"}}>
            {activeSections.map(sec=>(
              <div key={sec.key} style={{margin:"10px 14px 0"}}>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.onSurfaceVariant,padding:"4px 0 6px",borderBottom:`0.5px solid ${M3.outlineVariant}`,marginBottom:6}}>{sec.label}</div>
                {grouped[sec.key].filter(item=>!checkedItems.has(item.key)).map(item=>{
                  const isEd=editingKey===item.key;
                  const recipeNames=item.recipeList||[item.recipe];
                  return (
                    <div key={item.key} style={{background:M3.surface,borderRadius:12,border:`0.5px solid ${M3.outlineVariant}`,padding:"10px 12px",marginBottom:4,display:"flex",alignItems:"flex-start",gap:10}}>
                      <div onClick={()=>toggleItem(item.key)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${M3.outline}`,background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",marginTop:2}}/>
                      <div style={{flex:1,minWidth:0}}>
                        {isEd?(
                          <input autoFocus value={editingText} onChange={e=>setEditingText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEdit(item.key);if(e.key==="Escape")setEditingKey(null);}} onBlur={()=>saveEdit(item.key)}
                            style={{width:"100%",fontSize:14,padding:"3px 8px",border:`1.5px solid ${M3.primary}`,borderRadius:6,fontFamily:font,outline:"none",boxSizing:"border-box",background:M3.surface,color:M3.onSurface}}/>
                        ):(
                          <>
                            <div onClick={()=>toggleItem(item.key)} style={{fontSize:14,color:M3.onSurface,cursor:"pointer"}}>{item.text}</div>
                            <div style={{marginTop:3,display:"flex",flexWrap:"wrap",gap:4}}>
                              {recipeNames.map((name,idx)=>{ const r=recipes.find(r=>r.title===name.trim()); return r?(
                                <span key={idx} onClick={()=>{setSelectedId(r.id);setView("recipes");}} style={{fontSize:11,color:M3.primary,fontStyle:"italic",textDecoration:"underline",cursor:"pointer"}}>{name}{idx<recipeNames.length-1?",":""}</span>
                              ):(<span key={idx} style={{fontSize:11,color:M3.onSurfaceVariant,fontStyle:"italic"}}>{name}</span>); })}
                            </div>
                          </>
                        )}
                      </div>
                      <span onClick={e=>startEdit(item.key,item.text,e)} style={{fontSize:13,color:M3.outlineVariant,cursor:"pointer",padding:"2px 5px",flexShrink:0}}>✎</span>
                      <span onClick={()=>removeItem(item.key)} style={{fontSize:13,color:M3.outlineVariant,cursor:"pointer",padding:"2px 5px",flexShrink:0}}>✕</span>
                      <span style={{fontSize:10,color:M3.onSurfaceVariant,background:M3.surfaceVariant,borderRadius:6,padding:"2px 7px",whiteSpace:"nowrap",flexShrink:0}}>A{sec.aisle}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {completedItems.length>0&&(
              <div style={{margin:"16px 14px 0"}}>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.onSurfaceVariant,padding:"4px 0 6px",borderBottom:`0.5px solid ${M3.outlineVariant}`,marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
                  <svg width="12" height="12" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" stroke={M3.success} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Completed ({completedItems.length})
                </div>
                {completedItems.map(item=>{
                  const sec=STORE_SECTIONS.find(s=>s.key===item.sectionKey);
                  const recipeNames=item.recipeList||[item.recipe];
                  return (
                    <div key={item.key} style={{background:M3.surface,borderRadius:12,border:`0.5px solid ${M3.outlineVariant}`,padding:"10px 12px",marginBottom:4,display:"flex",alignItems:"flex-start",gap:10,opacity:0.5}}>
                      <div onClick={()=>toggleItem(item.key)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${M3.primary}`,background:M3.primary,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",marginTop:2}}>
                        <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="2,5 4,7 8,3" stroke={M3.onPrimary} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,textDecoration:"line-through",color:M3.onSurfaceVariant}}>{item.text}</div>
                        <div style={{marginTop:2,display:"flex",flexWrap:"wrap",gap:4}}>
                          {recipeNames.map((name,idx)=>(<span key={idx} style={{fontSize:11,color:M3.onSurfaceVariant,fontStyle:"italic"}}>{name}{idx<recipeNames.length-1?",":""}</span>))}
                        </div>
                      </div>
                      <span onClick={()=>removeItem(item.key)} style={{fontSize:13,color:M3.outlineVariant,cursor:"pointer",padding:"2px 5px",flexShrink:0}}>✕</span>
                      {sec&&<span style={{fontSize:10,color:M3.onSurfaceVariant,background:M3.surfaceVariant,borderRadius:6,padding:"2px 7px",whiteSpace:"nowrap",flexShrink:0}}>A{sec.aisle}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {/* Target sections */}
        {storeTab==="target"&&(targetTotal===0?(
          <p style={{textAlign:"center",padding:"40px 20px",color:M3.onSurfaceVariant,fontStyle:"italic"}}>No items yet. Add above.</p>
        ):(
          <div style={{padding:"4px 0"}}>
            {targetActiveCats.map(cat=>(
              <div key={cat.key} style={{margin:"10px 14px 0"}}>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.onSurfaceVariant,padding:"4px 0 6px",borderBottom:`0.5px solid ${M3.outlineVariant}`,marginBottom:6}}>{cat.label}</div>
                {targetGrouped[cat.key].map(item=><GenericItem key={item.key} item={item} done={targetChecked.has(item.key)} onToggle={toggleTargetItem} onRemove={removeTargetItem}/>)}
              </div>
            ))}
          </div>
        ))}

        {/* Lowe's sections */}
        {storeTab==="lowes"&&(lowesTotal===0?(
          <p style={{textAlign:"center",padding:"40px 20px",color:M3.onSurfaceVariant,fontStyle:"italic"}}>No items yet. Add above.</p>
        ):(
          <div style={{padding:"4px 0"}}>
            {lowesActiveCats.map(cat=>(
              <div key={cat.key} style={{margin:"10px 14px 0"}}>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.onSurfaceVariant,padding:"4px 0 6px",borderBottom:`0.5px solid ${M3.outlineVariant}`,marginBottom:6}}>{cat.label}</div>
                {lowesGrouped[cat.key].map(item=><GenericItem key={item.key} item={item} done={lowesChecked.has(item.key)} onToggle={toggleLowesItem} onRemove={removeLowesItem}/>)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <BottomNav view={view} setView={setView} totalItems={totalItems} M3={M3} font={font} photoInputRef={photoInputRef}/>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // IMPORT SCREEN
  if (view==="import") return (
    <div style={{fontFamily:font,background:M3.background,minHeight:"100vh",color:M3.onSurface,paddingBottom:90}}>
      <div style={{background:M3.primary,padding:"14px 16px 20px"}}>
        <div style={{fontSize:11,color:`${M3.onPrimary}99`,letterSpacing:1.2,marginBottom:3}}>Add recipes</div>
        <div style={{fontSize:22,fontWeight:500,color:M3.onPrimary}}>Import</div>
      </div>

      <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
        {/* Paste text */}
        <div style={{background:M3.surface,border:`0.5px solid ${M3.outlineVariant}`,borderRadius:16,overflow:"hidden"}}>
          <button onClick={()=>setShowImport(v=>!v)}
            style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:"16px 18px",display:"flex",alignItems:"center",gap:14,fontFamily:font,textAlign:"left"}}>
            <div style={{width:48,height:48,borderRadius:12,background:M3.secondaryContainer,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>📝</div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:500,color:M3.onSurface}}>Paste text</div>
              <div style={{fontSize:13,color:M3.onSurfaceVariant,marginTop:2}}>Copy & paste a recipe from anywhere</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d={showImport?"M4 10l4-4 4 4":"M4 6l4 4 4-4"} stroke={M3.outline} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {showImport&&(
            <div style={{padding:"0 16px 16px"}}>
              <textarea value={importText} onChange={e=>setImportText(e.target.value)}
                style={{width:"100%",height:160,border:`1px solid ${M3.outlineVariant}`,borderRadius:8,padding:10,fontSize:13,fontFamily:font,background:M3.surfaceVariant,color:M3.onSurface,resize:"vertical",boxSizing:"border-box",outline:"none",lineHeight:1.6}}
                placeholder={"Recipe Title\nCategory: Mains\nServings: 4\nIngredients:\n- ingredient\nInstructions:\n1. Step one"}/>
              <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end"}}>
                <button onClick={()=>{setShowImport(false);setImportText("");}} style={{padding:"8px 16px",background:"transparent",color:M3.onSurface,border:`1px solid ${M3.outline}`,borderRadius:20,cursor:"pointer",fontSize:13,fontFamily:font}}>Clear</button>
                <button onClick={async()=>{await handleImport();setView("recipes");}} style={{padding:"8px 20px",background:M3.primary,color:M3.onPrimary,border:"none",borderRadius:20,cursor:"pointer",fontSize:13,fontFamily:font,fontWeight:500}}>Save recipe</button>
              </div>
            </div>
          )}
        </div>

        {/* Photo */}
        <div style={{background:M3.surface,border:`0.5px solid ${M3.outlineVariant}`,borderRadius:16,overflow:"hidden"}}>
          <button onClick={()=>photoInputRef.current?.click()}
            style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:"16px 18px",display:"flex",alignItems:"center",gap:14,fontFamily:font,textAlign:"left"}}>
            <div style={{width:48,height:48,borderRadius:12,background:M3.secondaryContainer,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>📷</div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:500,color:M3.onSurface}}>Photo</div>
              <div style={{fontSize:13,color:M3.onSurfaceVariant,marginTop:2}}>Take or upload a photo of a recipe</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke={M3.outline} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {showPhotoImport&&(
            <div style={{padding:"0 16px 16px",textAlign:"center"}}>
              {photoImporting?(
                <>
                  <div style={{fontSize:13,color:M3.onSurfaceVariant,fontWeight:500}}>Reading recipe from photo…</div>
                  <div style={{fontSize:12,color:M3.secondary,marginTop:4}}>This usually takes 5–10 seconds</div>
                </>
              ):photoError?(
                <>
                  <p style={{fontSize:13,color:M3.error,marginBottom:10}}>{photoError}</p>
                  <button onClick={()=>{setShowPhotoImport(false);setPhotoError(null);}} style={{padding:"8px 20px",background:M3.primary,color:M3.onPrimary,border:"none",borderRadius:20,cursor:"pointer",fontSize:13,fontFamily:font}}>OK</button>
                </>
              ):null}
            </div>
          )}
        </div>

        {/* URL */}
        <div style={{background:M3.surface,border:`0.5px solid ${M3.outlineVariant}`,borderRadius:16,overflow:"hidden"}}>
          <button onClick={()=>setShowUrlImport(v=>!v)}
            style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:"16px 18px",display:"flex",alignItems:"center",gap:14,fontFamily:font,textAlign:"left"}}>
            <div style={{width:48,height:48,borderRadius:12,background:M3.secondaryContainer,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:22}}>🔗</div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:500,color:M3.onSurface}}>URL / link</div>
              <div style={{fontSize:13,color:M3.onSurfaceVariant,marginTop:2}}>Import directly from a recipe website</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d={showUrlImport?"M4 10l4-4 4 4":"M4 6l4 4 4-4"} stroke={M3.outline} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {showUrlImport&&(
            <div style={{padding:"0 16px 16px"}}>
              {urlImporting?(
                <div style={{textAlign:"center",padding:"8px 0"}}>
                  <div style={{fontSize:13,color:M3.onSurfaceVariant,fontWeight:500}}>Fetching recipe…</div>
                  <div style={{fontSize:12,color:M3.secondary,marginTop:4}}>This usually takes 5–15 seconds</div>
                </div>
              ):(
                <>
                  {urlImportError&&<p style={{fontSize:12,color:M3.error,marginBottom:8}}>⚠ {urlImportError}</p>}
                  <input value={urlImportValue} onChange={e=>setUrlImportValue(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleUrlImport()}
                    placeholder="https://example.com/recipes/…"
                    style={{width:"100%",padding:"10px 12px",border:`1px solid ${M3.outlineVariant}`,borderRadius:8,fontSize:13,fontFamily:font,background:M3.surfaceVariant,color:M3.onSurface,boxSizing:"border-box",outline:"none"}}/>
                  <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end"}}>
                    <button onClick={()=>{setShowUrlImport(false);setUrlImportValue("");setUrlImportError(null);}} style={{padding:"8px 16px",background:"transparent",color:M3.onSurface,border:`1px solid ${M3.outline}`,borderRadius:20,cursor:"pointer",fontSize:13,fontFamily:font}}>Cancel</button>
                    <button onClick={async()=>{await handleUrlImport();}} style={{padding:"8px 20px",background:M3.primary,color:M3.onPrimary,border:"none",borderRadius:20,cursor:"pointer",fontSize:13,fontFamily:font,fontWeight:500}}>Import</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <BottomNav view={view} setView={setView} totalItems={totalItems} M3={M3} font={font} photoInputRef={photoInputRef}/>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // RECIPE DETAIL
  if (selected) {
    const ratio=selected.servings/selected.baseServings;
    const isEditing=editingRecipeId===selected.id;
    return (
      <div style={{fontFamily:font,background:M3.background,minHeight:"100vh",color:M3.onSurface,paddingBottom:40}}>
        <div style={{background:M3.primary,padding:"14px 16px 18px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <button onClick={()=>{setSelectedId(null);cancelEditRecipe();setConfirmDelete(false);if(wakeLock)wakeLock.release();setWakeActive(false);setWakeLock(null);}}
              style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:6}}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke={M3.primaryContainer} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{fontSize:13,color:M3.primaryContainer}}>Recipes</span>
            </button>
            {!isEditing&&(
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {confirmDelete?(
                  <>
                    <span style={{fontSize:12,color:M3.errorContainer}}>Delete?</span>
                    <button onClick={()=>deleteRecipe(selected.id)} style={{padding:"5px 12px",background:M3.error,border:"none",borderRadius:20,color:M3.onError,fontSize:12,cursor:"pointer",fontFamily:font}}>Delete</button>
                    <button onClick={()=>setConfirmDelete(false)} style={{padding:"5px 12px",background:"transparent",border:`1px solid ${M3.primaryContainer}`,borderRadius:20,color:M3.primaryContainer,fontSize:12,cursor:"pointer",fontFamily:font}}>Cancel</button>
                  </>
                ):(
                  <>
                    <button onClick={()=>setConfirmDelete(true)} style={{padding:"5px 12px",background:"transparent",border:`1px solid ${M3.errorContainer}`,borderRadius:20,color:M3.errorContainer,fontSize:12,cursor:"pointer",fontFamily:font}}>Delete</button>
                    <button onClick={()=>startEditRecipe(selected)} style={{padding:"5px 14px",background:M3.primaryContainer,border:"none",borderRadius:20,color:M3.onPrimaryContainer,fontSize:12,cursor:"pointer",fontFamily:font,fontWeight:500}}>Edit</button>
                  </>
                )}
              </div>
            )}
            {isEditing&&(
              <div style={{display:"flex",gap:8}}>
                <button onClick={cancelEditRecipe} style={{padding:"5px 12px",background:"transparent",border:`1px solid ${M3.primaryContainer}`,borderRadius:20,color:M3.primaryContainer,fontSize:12,cursor:"pointer",fontFamily:font}}>Cancel</button>
                <button onClick={()=>saveEditRecipe(selected.id)} style={{padding:"5px 14px",background:M3.primaryContainer,border:"none",borderRadius:20,color:M3.onPrimaryContainer,fontSize:12,cursor:"pointer",fontFamily:font,fontWeight:500}}>Save</button>
              </div>
            )}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:22,fontWeight:500,color:M3.onPrimary,lineHeight:1.2,marginBottom:3}}>{selected.title}</div>
              <div style={{fontSize:13,color:`${M3.onPrimary}AA`}}>{selected.category}</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:2}}>
              <button onClick={toggleWakeLock} style={{background:wakeActive?M3.primaryContainer:"transparent",border:`1px solid ${M3.primaryContainer}`,borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:500,color:wakeActive?M3.onPrimaryContainer:M3.primaryContainer,cursor:"pointer",fontFamily:font}}>
                {wakeActive?"☀ On":"☀ Off"}
              </button>
              <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:M3.primaryContainer}} onClick={()=>toggleFav(selected.id)}>
                {selected.favorite?"★":"☆"}
              </button>
            </div>
          </div>
        </div>

        <div style={{padding:16}}>
          {isEditing?(
            <>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.secondary,display:"block",marginBottom:6}}>Title</label>
                <input value={editDraft.title} onChange={e=>setEditDraft(d=>({...d,title:e.target.value}))} style={inp}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.secondary,display:"block",marginBottom:6}}>Category</label>
                <select value={editDraft.category} onChange={e=>setEditDraft(d=>({...d,category:e.target.value}))} style={inp}>
                  {CATEGORIES.filter(c=>c!=="All"&&c!=="Favorites").map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.secondary,display:"block",marginBottom:6}}>Servings</label>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <button onClick={()=>setEditDraft(d=>({...d,servings:Math.max(1,(parseInt(d.servings)||1)-1)}))} style={{width:34,height:34,borderRadius:"50%",border:`1.5px solid ${M3.outline}`,background:"transparent",color:M3.primary,fontSize:18,cursor:"pointer",fontFamily:font,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                  <input type="number" min={1} max={999} value={editDraft.servings} onChange={e=>setEditDraft(d=>({...d,servings:e.target.value}))} onBlur={()=>setEditDraft(d=>({...d,servings:Math.max(1,parseInt(d.servings)||1)}))} style={{...inp,width:70,textAlign:"center",padding:"8px"}}/>
                  <button onClick={()=>setEditDraft(d=>({...d,servings:(parseInt(d.servings)||1)+1}))} style={{width:34,height:34,borderRadius:"50%",background:M3.primary,border:"none",color:M3.onPrimary,fontSize:18,cursor:"pointer",fontFamily:font,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                  <span style={{fontSize:12,color:M3.onSurfaceVariant}}>Base: {editDraft.baseServings}</span>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.secondary,display:"block",marginBottom:6}}>Ingredients <span style={{fontSize:10,color:M3.onSurfaceVariant,textTransform:"none",letterSpacing:0}}>(one per line)</span></label>
                <textarea value={editDraft.ingredients} onChange={e=>setEditDraft(d=>({...d,ingredients:e.target.value}))} style={{...inp,height:180,resize:"vertical",lineHeight:1.6}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.secondary,display:"block",marginBottom:6}}>Instructions <span style={{fontSize:10,color:M3.onSurfaceVariant,textTransform:"none",letterSpacing:0}}>(one per line)</span></label>
                <textarea value={editDraft.instructions} onChange={e=>setEditDraft(d=>({...d,instructions:e.target.value}))} style={{...inp,height:220,resize:"vertical",lineHeight:1.6}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.secondary,display:"block",marginBottom:6}}>Notes</label>
                <textarea value={editDraft.notes} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} style={{...inp,height:100,resize:"vertical",lineHeight:1.6}} placeholder="Personal tweaks, substitutions…"/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:M3.secondary,display:"block",marginBottom:6}}>Storage</label>
                <textarea value={editDraft.storage} onChange={e=>setEditDraft(d=>({...d,storage:e.target.value}))} style={{...inp,height:80,resize:"vertical",lineHeight:1.6}} placeholder="e.g. Refrigerate up to 3 days"/>
              </div>
            </>
          ):(
            <>
              {/* Servings */}
              <div style={{background:M3.secondaryContainer,borderRadius:16,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:14}}>
                <div onClick={()=>setServings(selected.id,selected.servings-1)} style={{width:32,height:32,borderRadius:"50%",border:`1.5px solid ${M3.secondary}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8" stroke={M3.secondary} strokeWidth="1.5" strokeLinecap="round"/></svg>
                </div>
                <div style={{textAlign:"center",minWidth:40}}>
                  <div style={{fontSize:22,fontWeight:500,color:M3.onSecondaryContainer,lineHeight:1}}>{selected.servings}</div>
                  <div style={{fontSize:11,color:M3.secondary,marginTop:2}}>servings</div>
                </div>
                <div onClick={()=>setServings(selected.id,selected.servings+1)} style={{width:32,height:32,borderRadius:"50%",background:M3.secondary,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke={M3.onSecondary} strokeWidth="1.5" strokeLinecap="round"/></svg>
                </div>
                <input type="range" min={1} max={24} step={1} value={Math.min(selected.servings,24)} onChange={e=>setServings(selected.id,parseInt(e.target.value))} style={{flex:1}}/>
              </div>

              {selected.ingredients.length>0&&<>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:M3.primary,borderBottom:`1.5px solid ${M3.outlineVariant}`,paddingBottom:6,marginBottom:10,marginTop:20}}>Ingredients</div>
                {selected.ingredients.map((ing,i)=><div key={i} style={{fontSize:14,padding:"6px 0",borderBottom:`0.5px solid ${M3.outlineVariant}`,color:M3.onSurface}}>{ratio!==1?scaleIngredient(ing,ratio):ing}</div>)}
              </>}

              {selected.instructions.length>0&&<>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:M3.primary,borderBottom:`1.5px solid ${M3.outlineVariant}`,paddingBottom:6,marginBottom:10,marginTop:20}}>Instructions</div>
                {selected.instructions.map((step,i)=>{
                  const secs=extractTimerSeconds(step);
                  return (
                    <div key={i} style={{fontSize:14,padding:"8px 0",lineHeight:1.6,display:"flex",gap:12,borderBottom:`0.5px solid ${M3.outlineVariant}`}}>
                      <div style={{minWidth:24,height:24,borderRadius:"50%",background:M3.primary,color:M3.onPrimary,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:500,marginTop:2,flexShrink:0}}>{i+1}</div>
                      <div style={{flex:1}}>
                        <div style={{color:M3.onSurface}}>{step}</div>
                        {secs&&<StepTimer key={`${selected.id}-${i}`} seconds={secs} stepText={step}/>}
                      </div>
                    </div>
                  );
                })}
              </>}

              {selected.storage&&<>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:M3.primary,borderBottom:`1.5px solid ${M3.outlineVariant}`,paddingBottom:6,marginBottom:10,marginTop:20}}>Storage</div>
                <div style={{fontSize:14,lineHeight:1.7,color:M3.onSurface,background:M3.surfaceVariant,borderRadius:12,padding:"12px 14px"}}>{selected.storage}</div>
              </>}

              {selected.notes&&<>
                <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:M3.primary,borderBottom:`1.5px solid ${M3.outlineVariant}`,paddingBottom:6,marginBottom:10,marginTop:20}}>Notes</div>
                <div style={{fontSize:14,lineHeight:1.7,color:M3.onSurface,background:M3.surfaceVariant,borderRadius:12,padding:"12px 14px"}}>{selected.notes}</div>
              </>}
            </>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RECIPE LIST
  return (
    <div style={{fontFamily:font,background:M3.background,minHeight:"100vh",color:M3.onSurface,paddingBottom:40}}>
      {/* Sticky header */}
      <div style={{background:M3.primary,padding:"14px 16px 0",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:22,fontWeight:500,color:M3.onPrimary,letterSpacing:-0.2}}>{APP_NAME}</div>
        </div>

        {/* Category chips */}
        <div style={{display:"flex",overflowX:"auto",scrollbarWidth:"none",gap:6,paddingBottom:10}}>
          {CATEGORIES.map(cat=>{
            const active=activeTab===cat;
            return (
              <button key={cat} onClick={()=>setActiveTab(cat)}
                style={{padding:"6px 14px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap",borderRadius:20,fontFamily:font,fontWeight:active?500:400,background:active?M3.primaryContainer:"transparent",color:active?M3.onPrimaryContainer:M3.primaryContainer,flexShrink:0,border:active?"none":`1px solid ${M3.primaryContainer}`}}>
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoImport} style={{display:"none"}}/>
      <div style={{padding:"12px 14px 6px",display:"flex",gap:8,alignItems:"center"}}>
        <div style={{flex:1,position:"relative",display:"flex",alignItems:"center"}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{position:"absolute",left:12,flexShrink:0,pointerEvents:"none"}}>
            <circle cx="7" cy="7" r="5" stroke={M3.onSurfaceVariant} strokeWidth="1.3"/>
            <line x1="11" y1="11" x2="14" y2="14" stroke={M3.onSurfaceVariant} strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input placeholder="Search recipes or ingredients…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{width:"100%",padding:"9px 12px 9px 34px",borderRadius:28,border:`1px solid ${M3.outlineVariant}`,background:M3.surfaceVariant,color:M3.onSurface,fontSize:14,outline:"none",fontFamily:font,boxSizing:"border-box"}}/>
        </div>
        <button onClick={()=>setSortAZ(v=>!v)} style={{padding:"9px 14px",borderRadius:20,border:`1px solid ${M3.outlineVariant}`,background:"transparent",color:M3.onSurfaceVariant,fontSize:12,cursor:"pointer",fontFamily:font,whiteSpace:"nowrap"}}>
          {sortAZ?"A→Z":"Z→A"}
        </button>
      </div>

      {/* Recipe list */}
      <div style={{padding:"8px 14px 0",paddingBottom:90}}>
        {filtered.length===0?(
          <p style={{textAlign:"center",padding:"40px 20px",color:M3.onSurfaceVariant,fontStyle:"italic"}}>
            {search?"No recipes match your search.":activeTab==="Favorites"?"No favorites yet.":"No recipes in this category yet."}
          </p>
        ):filtered.map(r=>(
          <div key={r.id} style={{background:M3.surface,border:`0.5px solid ${checkedIds.has(r.id)?M3.primary:M3.outlineVariant}`,borderRadius:12,padding:"11px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
            <div onClick={e=>toggleCheck(r.id,e)} style={{width:22,height:22,borderRadius:6,border:`2px solid ${checkedIds.has(r.id)?M3.primary:M3.outline}`,background:checkedIds.has(r.id)?M3.primary:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
              {checkedIds.has(r.id)&&<svg width="12" height="12" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" stroke={M3.onPrimary} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <div style={{flex:1,cursor:"pointer",minWidth:0}} onClick={()=>setSelectedId(r.id)}>
              <p style={{fontSize:15,fontWeight:500,margin:0,color:M3.onSurface,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</p>
              <p style={{fontSize:12,color:M3.onSurfaceVariant,marginTop:2}}>{r.category} · {r.servings} servings</p>
            </div>
            <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:r.favorite?M3.primary:M3.outlineVariant,flexShrink:0}} onClick={e=>toggleFav(r.id,e)}>
              {r.favorite?"★":"☆"}
            </button>
          </div>
        ))}
      </div>

      {/* M3 Bottom Navigation Bar */}
      <BottomNav view={view} setView={setView} totalItems={totalItems} M3={M3} font={font} photoInputRef={photoInputRef}/>
    </div>
  );
}
