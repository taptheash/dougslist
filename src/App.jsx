import { useState, useMemo, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch
} from "firebase/firestore";
import {
  APP_NAME, GROCERY_STORE_NAME,
  CATEGORIES, STORE_SECTIONS, TARGET_CATEGORIES, TARGET_KEYWORDS,
  classifyTarget, LOWES_CATEGORIES, LOWES_KEYWORDS, classifyLowes,
  KEYWORD_MAP, classifyIngredient, PREP_STRIP, COOK_WORDS,
  SPICES_AND_PANTRY, MEAT_CONVERSIONS, PRODUCE_CONVERSIONS,
  toShoppingText, parseAmount, formatQty, combineItems,
  PRODUCE_ORDER, produceSubSort
} from './config.js';

// --- Timer helpers ---
const extractTimerSeconds = (text) => {
  const t = text.toLowerCase();
  let total = 0;
  const rangeMin = t.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*minutes?/);
  if (rangeMin) { total += parseInt(rangeMin[2]) * 60; }
  const rangeHr = t.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*hours?/);
  if (rangeHr) { total += parseInt(rangeHr[2]) * 3600; }
  if (rangeMin || rangeHr) return total || null;
  const hrs = t.match(/(\d+(?:\.\d+)?)\s*hours?/);
  const mins = t.match(/(\d+(?:\.\d+)?)\s*minutes?/);
  const secs = t.match(/(\d+)\s*seconds?/);
  if (hrs) total += parseFloat(hrs[1]) * 3600;
  if (mins) total += parseFloat(mins[1]) * 60;
  if (secs) total += parseInt(secs[1]);
  return total > 0 ? Math.round(total) : null;
};

const fmtTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
};

const requestNotificationPermission = async () => {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch(e) {}
};

const sendNotification = (title, body) => {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch(e) {}
};

function StepTimer({ seconds, stepText, kraft, tabBg, cream, darkBrown }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const intervalRef = useRef(null);
  useEffect(() => { setRemaining(seconds); setRunning(false); setDone(false); }, [seconds]);
  useEffect(() => {
    if (running) {
      requestNotificationPermission();
      intervalRef.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            setDone(true);
            try { sendNotification("⏱️ Timer Done!", stepText ? `Step complete: ${stepText.slice(0,60)}` : "Your cooking timer is done!"); } catch(e) {}
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else { clearInterval(intervalRef.current); }
    return () => clearInterval(intervalRef.current);
  }, [running]);
  const pct = Math.round(((seconds - remaining) / seconds) * 100);
  const bg = done ? "#22c55e" : running ? tabBg : "#e8d5a3";
  const fg = done ? "white" : darkBrown;
  const reset = (e) => { e.stopPropagation(); setRemaining(seconds); setRunning(false); setDone(false); };
  return (
    <div style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:6,background:bg,borderRadius:20,padding:"4px 10px 4px 6px",cursor:"pointer",transition:"background 0.3s",border:`1.5px solid ${done?"#22c55e":kraft}`}}
      onClick={e=>{e.stopPropagation(); if(done){reset(e);}else{setRunning(r=>!r);}}}>
      <svg width="22" height="22" viewBox="0 0 22 22" style={{flexShrink:0}}>
        <circle cx="11" cy="11" r="9" fill="none" stroke={done?"#bbf7d0":"#c8a96e"} strokeWidth="2.5"/>
        {!done && <circle cx="11" cy="11" r="9" fill="none" stroke={running?"#b5924a":"#8a6030"}
          strokeWidth="2.5" strokeDasharray={`${2*Math.PI*9}`}
          strokeDashoffset={`${2*Math.PI*9*(1-pct/100)}`}
          strokeLinecap="round" transform="rotate(-90 11 11)"
          style={{transition:"stroke-dashoffset 0.9s linear"}}/>}
        <text x="11" y="15" textAnchor="middle" fontSize="8" fontWeight="700"
          fill={done?"white":running?"#3d2b1a":"#8a6030"}>
          {done ? "✓" : running ? "▐▐" : "▶"}
        </text>
      </svg>
      <span style={{fontSize:13,fontWeight:600,color:fg,fontVariantNumeric:"tabular-nums",minWidth:38,textAlign:"center"}}>
        {done ? "Done!" : fmtTime(remaining)}
      </span>
      {(running || done) && <span onClick={reset} style={{fontSize:10,color:done?"white":"#8a6030",marginLeft:2,opacity:0.7}}>↺</span>}
    </div>
  );
}


const parseRecipes = (text) => {
  const blocks = text.split(/\n{2,}(?=[A-Z])/);
  return blocks.map((block,i) => {
    const lines = block.trim().split("\n").filter(l=>l.trim());
    if (!lines.length) return null;
    const title = lines[0].trim();
    let category="Other", servings=4, ingredients=[], instructions=[];
    let section=null;
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


export default function App() {
  const MB_RED="#c8102e",MB_DARK="#a00d24",cream="#fdf6e3",kraft="#c8a96e",darkBrown="#3d2b1a",tabBg="#b5924a",ringBg="#e8d5a3",font="'Trebuchet MS', Helvetica, sans-serif";

  // --- State ---
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sortAZ, setSortAZ] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [photoImporting, setPhotoImporting] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const photoInputRef = useRef(null);

  // --- Import dropdown ---
  const [showImportDropdown, setShowImportDropdown] = useState(false);
  const importDropdownRef = useRef(null);

  // --- URL import ---
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [urlImportValue, setUrlImportValue] = useState("");
  const [urlImporting, setUrlImporting] = useState(false);
  const [urlImportError, setUrlImportError] = useState(null);

  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [checkedItems, setCheckedItems] = useState(new Set());
  const [manualItems, setManualItems] = useState([]);
  const [removedKeys, setRemovedKeys] = useState(new Set());
  const [manualInput, setManualInput] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [view, setView] = useState("recipes");
  const [wakeLock, setWakeLock] = useState(null);
  const [wakeActive, setWakeActive] = useState(false);

  // --- Inline servings editing on list cards ---
  const [editingServingsId, setEditingServingsId] = useState(null);
  const [editingServingsVal, setEditingServingsVal] = useState("");
  const servingsInputRef = useRef(null);

  const toggleWakeLock = async () => {
    if (wakeActive && wakeLock) {
      await wakeLock.release();
      setWakeLock(null);
      setWakeActive(false);
    } else {
      try {
        if ("wakeLock" in navigator) {
          const lock = await navigator.wakeLock.request("screen");
          setWakeLock(lock);
          setWakeActive(true);
          lock.addEventListener("release", () => { setWakeActive(false); setWakeLock(null); });
        }
      } catch(e) { console.log("Wake lock failed:", e); }
    }
  };
  const shoppingLoaded = useRef(false);
  const [storeTab, setStoreTab] = useState("mb");
  const [targetItems, setTargetItems] = useState([]);
  const [targetChecked, setTargetChecked] = useState(new Set());
  const [targetInput, setTargetInput] = useState("");
  const [targetQty, setTargetQty] = useState("");
  const [targetCountdown, setTargetCountdown] = useState(null);
  const targetTimerRef = useRef(null);
  const targetResetAtRef = useRef(null);
  const [lowesItems, setLowesItems] = useState([]);
  const [lowesChecked, setLowesChecked] = useState(new Set());
  const [lowesInput, setLowesInput] = useState("");
  const [lowesQty, setLowesQty] = useState("");
  const [lowesCountdown, setLowesCountdown] = useState(null);
  const lowesTimerRef = useRef(null);
  const lowesResetAtRef = useRef(null);

  // Scroll to top on mount
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (importDropdownRef.current && !importDropdownRef.current.contains(e.target)) {
        setShowImportDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus servings input when it opens
  useEffect(() => {
    if (editingServingsId && servingsInputRef.current) {
      servingsInputRef.current.focus();
      servingsInputRef.current.select();
    }
  }, [editingServingsId]);

  // --- One-time migration ---
  useEffect(() => {
    const runMigration = async () => {
      const snap = await getDocs(collection(db, "recipes"));
      const batch = writeBatch(db);
      let needsUpdate = false;
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.notes === undefined || data.storage === undefined) {
          batch.update(doc(db, "recipes", d.id), { notes: data.notes ?? "", storage: data.storage ?? "" });
          needsUpdate = true;
        }
      });
      if (needsUpdate) await batch.commit();
    };
    runMigration();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "recipes"), (snap) => {
      const loaded = snap.docs.map(d => ({ id: d.id, ...d.data(), servings: d.data().servings || d.data().baseServings }));
      setRecipes(loaded);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "app", "shopping"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCheckedIds(new Set(data.checkedIds || []));
        setCheckedItems(new Set(data.checkedItems || []));
        setManualItems(data.manualItems || []);
        setRemovedKeys(new Set(data.removedKeys || []));
      }
      shoppingLoaded.current = true;
    });
    return () => unsub();
  }, []);

  const saveShoppingState = (updates) => {
    setDoc(doc(db, "app", "shopping"), updates, { merge: true });
  };

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "app", "target"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setTargetItems(data.items || []);
        setTargetChecked(new Set(data.checked || []));
        if (data.resetAt && !targetTimerRef.current) {
          const rem = data.resetAt - Date.now();
          if (rem <= 0) { resetTarget(); }
          else {
            targetResetAtRef.current = data.resetAt;
            targetTimerRef.current = setInterval(() => {
              const r = data.resetAt - Date.now();
              if (r <= 0) { resetTarget(); return; }
              const m = Math.floor(r/60000), s = Math.floor((r%60000)/1000);
              setTargetCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
            }, 1000);
          }
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "app", "lowes"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLowesItems(data.items || []);
        setLowesChecked(new Set(data.checked || []));
        if (data.resetAt && !lowesTimerRef.current) {
          const rem = data.resetAt - Date.now();
          if (rem <= 0) { resetLowes(); }
          else {
            lowesResetAtRef.current = data.resetAt;
            lowesTimerRef.current = setInterval(() => {
              const r = data.resetAt - Date.now();
              if (rem <= 0) { resetLowes(); return; }
              const m = Math.floor(r/60000), s = Math.floor((r%60000)/1000);
              setLowesCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
            }, 1000);
          }
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const targetTotal = targetItems.length;
    const targetCheckedCount = targetItems.filter(i => targetChecked.has(i.key)).length;
    if (targetTotal > 0 && targetCheckedCount === targetTotal) {
      if (targetTimerRef.current) return;
      const end = targetResetAtRef.current || Date.now() + 60*60*1000;
      targetResetAtRef.current = end;
      setDoc(doc(db, "app", "target"), { resetAt: end }, { merge: true });
      targetTimerRef.current = setInterval(() => {
        const rem = end - Date.now();
        if (rem <= 0) { resetTarget(); return; }
        const m = Math.floor(rem/60000), s = Math.floor((rem%60000)/1000);
        setTargetCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
      }, 1000);
    } else {
      if (targetTimerRef.current) { clearInterval(targetTimerRef.current); targetTimerRef.current = null; }
      targetResetAtRef.current = null;
      setTargetCountdown(null);
    }
  }, [targetChecked, targetItems]);

  useEffect(() => {
    const lowesTotal = lowesItems.length;
    const lowesCheckedCount = lowesItems.filter(i => lowesChecked.has(i.key)).length;
    if (lowesTotal > 0 && lowesCheckedCount === lowesTotal) {
      if (lowesTimerRef.current) return;
      const end = lowesResetAtRef.current || Date.now() + 60*60*1000;
      lowesResetAtRef.current = end;
      setDoc(doc(db, "app", "lowes"), { resetAt: end }, { merge: true });
      lowesTimerRef.current = setInterval(() => {
        const rem = end - Date.now();
        if (rem <= 0) { resetLowes(); return; }
        const m = Math.floor(rem/60000), s = Math.floor((rem%60000)/1000);
        setLowesCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
      }, 1000);
    } else {
      if (lowesTimerRef.current) { clearInterval(lowesTimerRef.current); lowesTimerRef.current = null; }
      lowesResetAtRef.current = null;
      setLowesCountdown(null);
    }
  }, [lowesChecked, lowesItems]);

  const addTargetItem = () => {
    if (!targetInput.trim()) return;
    const qty = parseInt(targetQty)||1; const text = qty > 1 ? `${qty} ${targetInput.trim()}` : targetInput.trim();
    const item = { key: `t${Date.now()}`, text, category: classifyTarget(targetInput.trim()) };
    const updated = [...targetItems, item];
    setTargetItems(updated);
    setDoc(doc(db, "app", "target"), { items: updated, checked: [...targetChecked] }, { merge: true });
    setTargetInput(""); setTargetQty("");
  };

  const toggleTargetItem = (key) => {
    setTargetChecked(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key);
      setDoc(doc(db, "app", "target"), { checked: [...n] }, { merge: true });
      return n;
    });
  };

  const removeTargetItem = (key) => {
    const updated = targetItems.filter(i => i.key !== key);
    setTargetItems(updated);
    setTargetChecked(prev => { const n = new Set(prev); n.delete(key); return n; });
    setDoc(doc(db, "app", "target"), { items: updated, checked: [...targetChecked].filter(k => k !== key) }, { merge: true });
  };

  const resetTarget = () => {
    setTargetItems([]); setTargetChecked(new Set()); setTargetCountdown(null);
    if (targetTimerRef.current) { clearInterval(targetTimerRef.current); targetTimerRef.current = null; }
    targetResetAtRef.current = null;
    setDoc(doc(db, "app", "target"), { items: [], checked: [], resetAt: null });
  };

  const addLowesItem = () => {
    if (!lowesInput.trim()) return;
    const qty = parseInt(lowesQty)||1; const text = qty > 1 ? `${qty} ${lowesInput.trim()}` : lowesInput.trim();
    const item = { key: `l${Date.now()}`, text, category: classifyLowes(lowesInput.trim()) };
    const updated = [...lowesItems, item];
    setLowesItems(updated);
    setDoc(doc(db, "app", "lowes"), { items: updated, checked: [...lowesChecked] }, { merge: true });
    setLowesInput(""); setLowesQty("");
  };

  const toggleLowesItem = (key) => {
    setLowesChecked(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key);
      setDoc(doc(db, "app", "lowes"), { checked: [...n] }, { merge: true });
      return n;
    });
  };

  const removeLowesItem = (key) => {
    const updated = lowesItems.filter(i => i.key !== key);
    setLowesItems(updated);
    setLowesChecked(prev => { const n = new Set(prev); n.delete(key); return n; });
    setDoc(doc(db, "app", "lowes"), { items: updated, checked: [...lowesChecked].filter(k => k !== key) }, { merge: true });
  };

  const resetLowes = () => {
    setLowesItems([]); setLowesChecked(new Set()); setLowesCountdown(null);
    if (lowesTimerRef.current) { clearInterval(lowesTimerRef.current); lowesTimerRef.current = null; }
    lowesResetAtRef.current = null;
    setDoc(doc(db, "app", "lowes"), { items: [], checked: [], resetAt: null });
  };

  const allShoppingItems = useMemo(() => {
    const items = [];
    recipes.filter(r=>checkedIds.has(r.id)).forEach(r => {
      const ratio = r.servings/r.baseServings;
      r.ingredients.forEach(ing => {
        const scaled = ratio!==1?scaleIngredient(ing,ratio):ing;
        const lower = ing.toLowerCase();
        if (lower.includes("salt and pepper")||lower.includes("salt & pepper")) {
          ["salt","pepper"].forEach(item => {
            const key=`r${r.id}::${item}`;
            if (!removedKeys.has(key)) items.push({ key, text:item, recipe:r.title, sectionKey:classifyIngredient(item), manual:false });
          });
        } else {
          const key=`r${r.id}::${ing}`;
          if (!removedKeys.has(key)) items.push({ key, text:toShoppingText(scaled), recipe:r.title, sectionKey:classifyIngredient(ing), manual:false });
        }
      });
    });
    manualItems.forEach(m=>{ if(!removedKeys.has(m.key)) items.push({...m,sectionKey:classifyIngredient(m.text),manual:true}); });
    return items;
  }, [checkedIds, recipes, manualItems, removedKeys]);

  const grouped = useMemo(() => {
    const g={};
    STORE_SECTIONS.forEach(s=>g[s.key]=[]);
    allShoppingItems.forEach(item=>{ (g[item.sectionKey]||g["kitchen"]).push(item); });
    const combined={};
    Object.keys(g).forEach(key=>{
      const items = combineItems(g[key]);
      combined[key] = key === "produce" ? produceSubSort(items) : items;
    });
    return combined;
  }, [allShoppingItems]);

  const total=allShoppingItems.length;
  const checked=allShoppingItems.filter(item=>checkedItems.has(item.key)).length;
  const pct=total>0?Math.round((checked/total)*100):0;
  const activeSections=STORE_SECTIONS.filter(s=>grouped[s.key]?.some(item=>!checkedItems.has(item.key)));
  const completedItems=allShoppingItems.filter(item=>checkedItems.has(item.key));

  const resetShopping = () => {
    const empty = { checkedIds:[], checkedItems:[], manualItems:[], removedKeys:[], resetAt:null };
    setCheckedIds(new Set()); setCheckedItems(new Set()); setManualItems([]); setRemovedKeys(new Set());
    setEditingKey(null);
    saveShoppingState(empty);
  };

  const toggleCheck = (id, e) => {
    e.stopPropagation();
    setCheckedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      saveShoppingState({ checkedIds: [...n] });
      return n;
    });
  };

  const toggleFav = async (id, e) => {
    e&&e.stopPropagation();
    const r = recipes.find(r=>r.id===id);
    if (!r) return;
    await updateDoc(doc(db,"recipes",id), { favorite: !r.favorite });
  };

  const setServings = (id, val) => {
    const v = Math.max(1,val);
    setRecipes(rs=>rs.map(r=>r.id===id?{...r,servings:v}:r));
    updateDoc(doc(db,"recipes",id), { servings: v });
  };

  // Inline servings handlers for list cards
  const openServingsEdit = (e, r) => {
    e.stopPropagation();
    setEditingServingsId(r.id);
    setEditingServingsVal(String(r.servings));
  };

  const commitServingsEdit = (id) => {
    const v = parseInt(editingServingsVal);
    if (!isNaN(v) && v >= 1) setServings(id, v);
    setEditingServingsId(null);
    setEditingServingsVal("");
  };

  const toggleItem = (key) => {
    setCheckedItems(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      saveShoppingState({ checkedItems: [...n] });
      return n;
    });
  };

  const removeItem = (key) => {
    setRemovedKeys(prev => { const n = new Set(prev); n.add(key); saveShoppingState({ removedKeys: [...n] }); return n; });
    setCheckedItems(prev => { const n = new Set(prev); n.delete(key); saveShoppingState({ checkedItems: [...n] }); return n; });
  };

  const startEdit = (key, text, e) => { e.stopPropagation(); setEditingKey(key); setEditingText(text); };

  const saveEdit = (key) => {
    if (!editingText.trim()) { setEditingKey(null); return; }
    const updated = manualItems.map(m=>m.key===key?{...m,text:editingText.trim()}:m);
    setManualItems(updated);
    saveShoppingState({ manualItems: updated });
    setEditingKey(null);
  };

  const addManual = () => {
    if (!manualInput.trim()) return;
    const qty = parseInt(manualQty)||1; const text = qty > 1 ? `${qty} ${manualInput.trim()}` : manualInput.trim();
    const item = { key:`m${Date.now()}`, text, recipe:"Added manually", manual:true };
    const updated = [...manualItems, item];
    setManualItems(updated);
    saveShoppingState({ manualItems: updated });
    setManualInput(""); setManualQty("");
  };

  // --- Shared recipe save helper ---
  const saveRecipesToFirestore = async (nr) => {
    const batch = writeBatch(db);
    nr.forEach((r, i) => {
      const id = `recipe_${Date.now()}_${i}`;
      batch.set(doc(db, "recipes", id), {
        title: r.title, category: r.category, baseServings: r.baseServings,
        servings: r.servings, ingredients: r.ingredients, instructions: r.instructions,
        favorite: false, notes: "", storage: ""
      });
    });
    await batch.commit();
  };

  const RECIPE_PROMPT = `Extract this recipe and format it exactly like this:

Recipe Title
Category: Mains
Servings: 4
Ingredients:
- ingredient 1
- ingredient 2
Instructions:
1. Step one
2. Step two

Use one of these categories: Appetizers, Italian, Soups & Stews, Mains, Meats, Fish & Seafood, Sides, Desserts, Breads & Breakfast, Drinks, Other.
Return ONLY the formatted recipe, nothing else.`;

  const handleImport = async () => {
    if (!importText.trim()) return;
    const nr = parseRecipes(importText);
    if (nr.length) {
      await saveRecipesToFirestore(nr);
      setImportText(""); setShowImport(false);
    }
  };

  const handlePhotoImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoImporting(true);
    setPhotoError(null);
    setShowPhotoImport(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.onerror = () => rej(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const mediaType = file.type || "image/jpeg";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: RECIPE_PROMPT }
            ]
          }]
        })
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const recipeText = data.content?.[0]?.text;
      if (!recipeText) throw new Error("No recipe text returned");
      const nr = parseRecipes(recipeText);
      if (!nr.length) throw new Error("Could not parse recipe from image");
      await saveRecipesToFirestore(nr);
      setShowPhotoImport(false);
      setPhotoImporting(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    } catch(err) {
      setPhotoError(err.message || "Something went wrong. Please try again.");
      setPhotoImporting(false);
    }
  };

  // --- URL Import ---
  const handleUrlImport = async () => {
    if (!urlImportValue.trim()) return;
    setUrlImporting(true);
    setUrlImportError(null);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 2000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{
            role: "user",
            content: `Fetch the recipe from this URL and extract it: ${urlImportValue.trim()}\n\n${RECIPE_PROMPT}`
          }]
        })
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const textBlock = data.content?.find(b => b.type === "text");
      const recipeText = textBlock?.text;
      if (!recipeText) throw new Error("No recipe text returned");
      const nr = parseRecipes(recipeText);
      if (!nr.length) throw new Error("Could not parse a recipe from that URL. Try the text import instead.");
      await saveRecipesToFirestore(nr);
      setShowUrlImport(false);
      setUrlImportValue("");
      setUrlImporting(false);
    } catch(err) {
      setUrlImportError(err.message || "Something went wrong. Please try again.");
      setUrlImporting(false);
    }
  };

  const startEditRecipe = (r) => {
    setEditDraft({title:r.title,category:r.category,servings:r.servings,baseServings:r.baseServings,ingredients:r.ingredients.join("\n"),instructions:r.instructions.join("\n"),notes:r.notes||"",storage:r.storage||""});
    setEditingRecipeId(r.id);
  };

  const saveEditRecipe = async (id) => {
    await updateDoc(doc(db,"recipes",id), {
      title: editDraft.title.trim(),
      category: editDraft.category,
      servings: Math.max(1, parseInt(editDraft.servings)||1),
      baseServings: Math.max(1, parseInt(editDraft.baseServings)||parseInt(editDraft.servings)||1),
      ingredients: editDraft.ingredients.split("\n").map(l=>l.replace(/^[-*•]\s*/,"").trim()).filter(Boolean),
      instructions: editDraft.instructions.split("\n").map(l=>l.replace(/^\d+[.)]\s*/,"").trim()).filter(Boolean),
      notes: editDraft.notes||"",
      storage: editDraft.storage||"",
    });
    setEditingRecipeId(null); setEditDraft(null);
  };

  const cancelEditRecipe = () => { setEditingRecipeId(null); setEditDraft(null); };

  const deleteRecipe = async (id) => {
    await deleteDoc(doc(db,"recipes",id));
    setSelectedId(null); setConfirmDelete(false);
  };

  const filtered = useMemo(() => {
    let list = recipes;
    if (activeTab==="Favorites") list=list.filter(r=>r.favorite);
    else if (activeTab!=="All") list=list.filter(r=>r.category===activeTab);
    if (search.trim()) { const q=search.toLowerCase(); list=list.filter(r=>r.title.toLowerCase().includes(q)||r.ingredients.some(i=>i.toLowerCase().includes(q))); }
    list = [...list].sort((a,b) => sortAZ ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
    return list;
  }, [recipes, activeTab, search, sortAZ]);

  const selected = recipes.find(r=>r.id===selectedId);

  if (loading) return (
    <div style={{fontFamily:font,background:cream,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:darkBrown}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:12}}>📖</div>
        <div style={{fontSize:16,color:tabBg}}>{`Loading ${APP_NAME}…`}</div>
      </div>
    </div>
  );

  // --- Shopping view ---
  if (view==="shopping") {
    const TARGET_RED = "#cc0000";
    const LOWES_BLUE = "#004990";
    const storeColor = storeTab === "mb" ? MB_RED : storeTab === "target" ? TARGET_RED : LOWES_BLUE;
    const storeDark = storeTab === "mb" ? MB_DARK : storeTab === "target" ? "#990000" : "#003370";
    const storeName = storeTab === "mb" ? GROCERY_STORE_NAME : storeTab === "target" ? "Target" : "Lowe's / Home Depot";

    const targetGrouped = {};
    TARGET_CATEGORIES.forEach(c => targetGrouped[c.key] = []);
    targetItems.forEach(item => { (targetGrouped[item.category] || targetGrouped["other"]).push(item); });
    const targetActiveCats = TARGET_CATEGORIES.filter(c => targetGrouped[c.key]?.length > 0);
    const targetTotal = targetItems.length;
    const targetCheckedCount = targetItems.filter(i => targetChecked.has(i.key)).length;
    const targetPct = targetTotal > 0 ? Math.round((targetCheckedCount / targetTotal) * 100) : 0;

    const lowesGrouped = {};
    LOWES_CATEGORIES.forEach(c => lowesGrouped[c.key] = []);
    lowesItems.forEach(item => { (lowesGrouped[item.category] || lowesGrouped["other"]).push(item); });
    const lowesActiveCats = LOWES_CATEGORIES.filter(c => lowesGrouped[c.key]?.length > 0);
    const lowesTotal = lowesItems.length;
    const lowesCheckedCount = lowesItems.filter(i => lowesChecked.has(i.key)).length;
    const lowesPct = lowesTotal > 0 ? Math.round((lowesCheckedCount / lowesTotal) * 100) : 0;

    const currentTotal = storeTab === "mb" ? total : storeTab === "target" ? targetTotal : lowesTotal;
    const currentChecked = storeTab === "mb" ? checked : storeTab === "target" ? targetCheckedCount : lowesCheckedCount;
    const currentPct = storeTab === "mb" ? pct : storeTab === "target" ? targetPct : lowesPct;
    const currentBarColor = currentPct===100?"#22c55e":currentPct>=66?"#84cc16":"#ffe066";

    const renderItem = (item, done, onToggle, onRemove, showAisle, aisle, color) => (
      <div key={item.key} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",background:"white",borderRadius:8,marginBottom:5,border:"1px solid #eee",opacity:done?0.5:1}}>
        <div onClick={()=>onToggle(item.key)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${done?color:"#ccc"}`,background:done?color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer"}}>
          {done&&<span style={{color:"white",fontSize:11,fontWeight:700}}>✓</span>}
        </div>
        <div onClick={()=>onToggle(item.key)} style={{flex:1,fontSize:15,textDecoration:done?"line-through":"none",color:done?"#aaa":"#222",cursor:"pointer"}}>{item.text}</div>
        <span onClick={()=>onRemove(item.key)} style={{fontSize:13,color:"#ccc",cursor:"pointer",padding:"2px 5px",flexShrink:0}}>✕</span>
        {showAisle && <span style={{fontSize:10,color:"#bbb",background:"#f5f5f0",borderRadius:4,padding:"2px 6px",border:"1px solid #e8e8e2",whiteSpace:"nowrap",flexShrink:0}}>{aisle}</span>}
      </div>
    );

    return (
      <div style={{fontFamily:font,background:"#f5f5f0",minHeight:"100vh",color:"#222",paddingBottom:40}}>
        <div style={{background:storeColor,color:"white",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:12,opacity:0.85}}>{storeName}</div>
            <div style={{fontSize:20,fontWeight:700,letterSpacing:0.5}}>🛒 Shopping List</div>
          </div>
          <button onClick={storeTab==="mb"?resetShopping:storeTab==="target"?resetTarget:resetLowes}
            style={{background:storeDark,color:"white",border:"none",borderRadius:6,padding:"6px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:font}}>Reset</button>
        </div>
        <div style={{background:storeDark,height:14,position:"relative"}}>
          <div style={{background:currentBarColor,height:14,width:currentPct+"%",transition:"width 0.4s ease"}}/>
          {currentPct>8&&<span style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",fontSize:10,fontWeight:700,color:currentPct>45?"#1a1a1a":"#fff8f0"}}>{currentPct}%</span>}
        </div>
        <div style={{background:"#fff8f0",padding:"8px 20px",fontSize:13,color:"#555",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #e0e0d8"}}>
          <span><strong style={{color:storeColor}}>{currentChecked}</strong> of <strong style={{color:storeColor}}>{currentTotal}</strong> items &nbsp;
            <span style={{color:"#aaa",fontSize:12}}>{currentTotal-currentChecked>0?`· ${currentTotal-currentChecked} remaining`:"· all done!"}</span>
          </span>
          {storeTab==="target"&&targetCountdown&&<span style={{color:storeColor,fontWeight:600,fontSize:12}}>{targetCountdown}</span>}
          {storeTab==="lowes"&&lowesCountdown&&<span style={{color:storeColor,fontWeight:600,fontSize:12}}>{lowesCountdown}</span>}
          <button onClick={()=>setView("recipes")} style={{background:"transparent",border:`1px solid ${storeColor}`,color:storeColor,borderRadius:6,padding:"4px 12px",fontSize:12,cursor:"pointer",fontFamily:font}}>← Back</button>
        </div>

        {storeTab==="mb"&&(
          <div>
            <div style={{padding:"10px 16px 0"}}>
              <div style={{display:"flex",gap:8}}>
                <input type="number" min={1} max={99} value={manualQty} onChange={e=>setManualQty(e.target.value)} onBlur={e=>setManualQty(v=>parseInt(v)||"")} placeholder="1" style={{width:52,padding:"8px 6px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white",textAlign:"center"}}/>
                <input value={manualInput} onChange={e=>setManualInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addManual()} placeholder="Add item to list..." style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white"}}/>
                <button onClick={addManual} style={{background:MB_RED,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,cursor:"pointer",fontWeight:600,fontFamily:font}}>Add</button>
              </div>
              {checkedIds.size>0&&<div style={{fontSize:12,color:"#888",marginTop:6,fontStyle:"italic"}}>Recipes: {recipes.filter(r=>checkedIds.has(r.id)).map(r=>r.title).join(", ")}</div>}
            </div>
            {total===0?(
              <p style={{textAlign:"center",padding:"40px 20px",color:"#888",fontStyle:"italic"}}>No items yet. Check recipes or add items above.</p>
            ):(
              <div style={{padding:"8px 0"}}>
                {/* Active (unchecked) sections */}
                {activeSections.map(sec=>(
                  <div key={sec.key} style={{margin:"10px 16px 0"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:"#888",padding:"6px 4px 4px",borderBottom:"1px solid #ddd",marginBottom:4}}>{sec.label}</div>
                    {grouped[sec.key].filter(item=>!checkedItems.has(item.key)).map(item=>{
                      const isEditingThis=editingKey===item.key;
                      const recipeNames=item.recipeList||[item.recipe];
                      return (
                        <div key={item.key} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 10px",background:"white",borderRadius:8,marginBottom:5,border:"1px solid #eee"}}>
                          <div onClick={()=>toggleItem(item.key)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid #ccc`,background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",marginTop:3}}/>
                          <div style={{flex:1,minWidth:0}}>
                            {isEditingThis?(
                              <input autoFocus value={editingText} onChange={e=>setEditingText(e.target.value)}
                                onKeyDown={e=>{if(e.key==="Enter")saveEdit(item.key);if(e.key==="Escape")setEditingKey(null);}}
                                onBlur={()=>saveEdit(item.key)}
                                style={{width:"100%",fontSize:14,padding:"3px 8px",border:`1.5px solid ${MB_RED}`,borderRadius:6,fontFamily:font,outline:"none",boxSizing:"border-box"}}/>
                            ):(
                              <>
                                <div onClick={()=>toggleItem(item.key)} style={{fontSize:15,color:"#222",cursor:"pointer"}}>{item.text}</div>
                                <div style={{marginTop:3,display:"flex",flexWrap:"wrap",gap:4}}>
                                  {recipeNames.map((name,idx)=>{
                                    const r=recipes.find(r=>r.title===name.trim());
                                    return r?(
                                      <span key={idx} onClick={()=>{setSelectedId(r.id);setView("recipes");}} style={{fontSize:11,color:MB_RED,fontStyle:"italic",textDecoration:"underline",cursor:"pointer"}}>
                                        {name}{idx<recipeNames.length-1?",":""}
                                      </span>
                                    ):(
                                      <span key={idx} style={{fontSize:11,color:"#aaa",fontStyle:"italic"}}>{name}</span>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                          <span onClick={e=>startEdit(item.key,item.text,e)} style={{fontSize:13,color:"#bbb",cursor:"pointer",padding:"2px 5px",flexShrink:0}}>✎</span>
                          <span onClick={()=>removeItem(item.key)} style={{fontSize:13,color:"#ccc",cursor:"pointer",padding:"2px 5px",flexShrink:0}}>✕</span>
                          <span style={{fontSize:10,color:"#bbb",background:"#f5f5f0",borderRadius:4,padding:"2px 6px",border:"1px solid #e8e8e2",whiteSpace:"nowrap",flexShrink:0}}>A{sec.aisle}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Completed section */}
                {completedItems.length > 0 && (
                  <div style={{margin:"18px 16px 0"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:"#bbb",padding:"6px 4px 4px",borderBottom:"1px solid #e0e0d8",marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                      <span style={{color:"#22c55e"}}>✓</span> Completed ({completedItems.length})
                    </div>
                    {completedItems.map(item=>{
                      const sec = STORE_SECTIONS.find(s=>s.key===item.sectionKey);
                      const recipeNames=item.recipeList||[item.recipe];
                      return (
                        <div key={item.key} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 10px",background:"white",borderRadius:8,marginBottom:5,border:"1px solid #eee",opacity:0.55}}>
                          <div onClick={()=>toggleItem(item.key)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${MB_RED}`,background:MB_RED,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",marginTop:3}}>
                            <span style={{color:"white",fontSize:11,fontWeight:700}}>✓</span>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div onClick={()=>toggleItem(item.key)} style={{fontSize:15,textDecoration:"line-through",color:"#aaa",cursor:"pointer"}}>{item.text}</div>
                            <div style={{marginTop:3,display:"flex",flexWrap:"wrap",gap:4}}>
                              {recipeNames.map((name,idx)=>{
                                const r=recipes.find(r=>r.title===name.trim());
                                return r?(
                                  <span key={idx} onClick={()=>{setSelectedId(r.id);setView("recipes");}} style={{fontSize:11,color:"#ccc",fontStyle:"italic",textDecoration:"underline",cursor:"pointer"}}>
                                    {name}{idx<recipeNames.length-1?",":""}
                                  </span>
                                ):(
                                  <span key={idx} style={{fontSize:11,color:"#ccc",fontStyle:"italic"}}>{name}</span>
                                );
                              })}
                            </div>
                          </div>
                          <span onClick={()=>removeItem(item.key)} style={{fontSize:13,color:"#ddd",cursor:"pointer",padding:"2px 5px",flexShrink:0}}>✕</span>
                          {sec&&<span style={{fontSize:10,color:"#ccc",background:"#f5f5f0",borderRadius:4,padding:"2px 6px",border:"1px solid #e8e8e2",whiteSpace:"nowrap",flexShrink:0}}>A{sec.aisle}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {storeTab==="target"&&(
          <div>
            <div style={{padding:"10px 16px 0"}}>
              <div style={{display:"flex",gap:8}}>
                <input type="number" min={1} max={99} value={targetQty} onChange={e=>setTargetQty(e.target.value)} placeholder="1" style={{width:52,padding:"8px 6px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white",textAlign:"center"}}/>
                <input value={targetInput} onChange={e=>setTargetInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTargetItem()} placeholder="Add item to Target list..." style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white"}}/>
                <button onClick={addTargetItem} style={{background:TARGET_RED,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,cursor:"pointer",fontWeight:600,fontFamily:font}}>Add</button>
              </div>
            </div>
            {targetTotal===0?(
              <p style={{textAlign:"center",padding:"40px 20px",color:"#888",fontStyle:"italic"}}>No items yet. Add items above.</p>
            ):(
              <div style={{padding:"8px 0"}}>
                {targetActiveCats.map(cat=>(
                  <div key={cat.key} style={{margin:"10px 16px 0"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:"#888",padding:"6px 4px 4px",borderBottom:"1px solid #ddd",marginBottom:4}}>{cat.label}</div>
                    {targetGrouped[cat.key].map(item=>renderItem(item,targetChecked.has(item.key),toggleTargetItem,removeTargetItem,false,"",TARGET_RED))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {storeTab==="lowes"&&(
          <div>
            <div style={{padding:"10px 16px 0"}}>
              <div style={{display:"flex",gap:8}}>
                <input type="number" min={1} max={99} value={lowesQty} onChange={e=>setLowesQty(e.target.value)} placeholder="1" style={{width:52,padding:"8px 6px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white",textAlign:"center"}}/>
                <input value={lowesInput} onChange={e=>setLowesInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addLowesItem()} placeholder="Add item to Lowe's list..." style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white"}}/>
                <button onClick={addLowesItem} style={{background:LOWES_BLUE,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,cursor:"pointer",fontWeight:600,fontFamily:font}}>Add</button>
              </div>
            </div>
            {lowesTotal===0?(
              <p style={{textAlign:"center",padding:"40px 20px",color:"#888",fontStyle:"italic"}}>No items yet. Add items above.</p>
            ):(
              <div style={{padding:"8px 0"}}>
                {lowesActiveCats.map(cat=>(
                  <div key={cat.key} style={{margin:"10px 16px 0"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:"#888",padding:"6px 4px 4px",borderBottom:"1px solid #ddd",marginBottom:4}}>{cat.label}</div>
                    {lowesGrouped[cat.key].map(item=>renderItem(item,lowesChecked.has(item.key),toggleLowesItem,removeLowesItem,false,"",LOWES_BLUE))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- Recipe detail view ---
  if (selected) {
    const ratio=selected.servings/selected.baseServings;
    const isEditing=editingRecipeId===selected.id;
    const inpStyle={width:"100%",padding:"7px 10px",border:`1.5px solid ${kraft}`,borderRadius:6,fontSize:14,fontFamily:font,background:cream,color:darkBrown,boxSizing:"border-box",outline:"none"};
    return (
      <div style={{fontFamily:font,background:cream,minHeight:"100vh",color:darkBrown,paddingBottom:40}}>
        <div style={{background:darkBrown,padding:"14px 16px",color:cream}}>
          <p style={{fontSize:22,fontWeight:500,margin:0,color:cream}}>{APP_NAME}</p>
        </div>
        <div style={{padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <button style={{background:"none",border:"none",color:tabBg,cursor:"pointer",fontSize:14,padding:0,fontFamily:font}} onClick={()=>{setSelectedId(null);cancelEditRecipe();setConfirmDelete(false);if(wakeLock){wakeLock.release();}setWakeActive(false);setWakeLock(null);}}>← Back</button>
            {!isEditing&&(
              <div style={{display:"flex",gap:8}}>
                {confirmDelete?(
                  <>
                    <span style={{fontSize:12,color:"#c0392b",alignSelf:"center"}}>Delete this recipe?</span>
                    <button onClick={()=>deleteRecipe(selected.id)} style={{padding:"6px 14px",background:"#c0392b",border:"none",borderRadius:6,color:"white",fontSize:13,cursor:"pointer",fontFamily:font}}>Yes, delete</button>
                    <button onClick={()=>setConfirmDelete(false)} style={{padding:"6px 14px",background:"transparent",border:`1px solid ${kraft}`,borderRadius:6,color:darkBrown,fontSize:13,cursor:"pointer",fontFamily:font}}>Cancel</button>
                  </>
                ):(
                  <>
                    <button onClick={()=>setConfirmDelete(true)} style={{padding:"6px 14px",background:"transparent",border:"1px solid #e0b0b0",borderRadius:6,color:"#c0392b",fontSize:13,cursor:"pointer",fontFamily:font}}>✕ Delete</button>
                    <button onClick={()=>startEditRecipe(selected)} style={{padding:"6px 16px",background:"transparent",border:`1.5px solid ${kraft}`,borderRadius:6,color:darkBrown,fontSize:13,cursor:"pointer",fontFamily:font}}>✎ Edit</button>
                  </>
                )}
              </div>
            )}
            {isEditing&&(
              <div style={{display:"flex",gap:8}}>
                <button onClick={cancelEditRecipe} style={{padding:"6px 14px",background:"transparent",border:`1px solid ${kraft}`,borderRadius:6,color:darkBrown,fontSize:13,cursor:"pointer",fontFamily:font}}>Cancel</button>
                <button onClick={()=>saveEditRecipe(selected.id)} style={{padding:"6px 16px",background:darkBrown,border:"none",borderRadius:6,color:cream,fontSize:13,cursor:"pointer",fontFamily:font}}>Save</button>
              </div>
            )}
          </div>
          {isEditing?(
            <>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Title</label>
                <input value={editDraft.title} onChange={e=>setEditDraft(d=>({...d,title:e.target.value}))} style={inpStyle}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Category</label>
                <select value={editDraft.category} onChange={e=>setEditDraft(d=>({...d,category:e.target.value}))} style={{...inpStyle,background:cream}}>
                  {CATEGORIES.filter(c=>c!=="All"&&c!=="Favorites").map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Servings</label>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>setEditDraft(d=>({...d,servings:Math.max(1,(parseInt(d.servings)||1)-1)}))}
                    style={{width:30,height:30,borderRadius:6,border:`1.5px solid ${kraft}`,background:"transparent",color:tabBg,fontSize:18,cursor:"pointer",fontFamily:font,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>−</button>
                  <input
                    type="number" min={1} max={999}
                    value={editDraft.servings}
                    onChange={e=>setEditDraft(d=>({...d,servings:e.target.value}))}
                    onBlur={e=>setEditDraft(d=>({...d,servings:Math.max(1,parseInt(d.servings)||1)}))}
                    style={{...inpStyle,width:64,textAlign:"center",padding:"6px 8px"}}
                  />
                  <button onClick={()=>setEditDraft(d=>({...d,servings:(parseInt(d.servings)||1)+1}))}
                    style={{width:30,height:30,borderRadius:6,border:`1.5px solid ${kraft}`,background:"transparent",color:tabBg,fontSize:18,cursor:"pointer",fontFamily:font,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>＋</button>
                  <span style={{fontSize:12,color:"#aaa",marginLeft:4}}>Base recipe serves {editDraft.baseServings}</span>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Ingredients <span style={{fontSize:10,color:"#aaa",textTransform:"none",letterSpacing:0}}>(one per line)</span></label>
                <textarea value={editDraft.ingredients} onChange={e=>setEditDraft(d=>({...d,ingredients:e.target.value}))} style={{...inpStyle,height:180,resize:"vertical",lineHeight:1.6}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Instructions <span style={{fontSize:10,color:"#aaa",textTransform:"none",letterSpacing:0}}>(one step per line)</span></label>
                <textarea value={editDraft.instructions} onChange={e=>setEditDraft(d=>({...d,instructions:e.target.value}))} style={{...inpStyle,height:220,resize:"vertical",lineHeight:1.6}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Notes</label>
                <textarea value={editDraft.notes} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} style={{...inpStyle,height:100,resize:"vertical",lineHeight:1.6}} placeholder="Personal tweaks, substitutions, family feedback..."/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Storage</label>
                <textarea value={editDraft.storage} onChange={e=>setEditDraft(d=>({...d,storage:e.target.value}))} style={{...inpStyle,height:80,resize:"vertical",lineHeight:1.6}} placeholder="e.g. Refrigerate up to 3 days, freeze up to 3 months"/>
              </div>
            </>
          ):(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <h2 style={{fontSize:22,fontWeight:500,margin:"0 0 4px"}}>{selected.title}</h2>
                  <p style={{fontSize:12,color:"#8a6030",fontStyle:"italic",marginBottom:16}}>{selected.category}</p>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <button onClick={toggleWakeLock} title={wakeActive?"Screen stay-on: ON":"Screen stay-on: OFF"}
                    style={{background:wakeActive?"#22c55e":"transparent",border:`1.5px solid ${wakeActive?"#22c55e":kraft}`,borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:600,color:wakeActive?"white":tabBg,cursor:"pointer",fontFamily:font}}>
                    {wakeActive?"☀️ On":"☀️ Off"}
                  </button>
                  <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18}} onClick={()=>toggleFav(selected.id)}>{selected.favorite?"★":"☆"}</button>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:12,background:ringBg,borderRadius:8,padding:"10px 14px",marginBottom:20}}>
                <span style={{fontSize:13,fontWeight:500,minWidth:60}}>Servings</span>
                <input type="number" min={1} max={100} value={selected.servings} onChange={e=>setServings(selected.id,parseInt(e.target.value)||1)} style={{width:48,padding:"4px 6px",border:`1px solid ${kraft}`,borderRadius:4,textAlign:"center",fontSize:15,fontFamily:font,background:cream,color:darkBrown}}/>
                <input type="range" min={1} max={24} step={1} value={Math.min(selected.servings,24)} onChange={e=>setServings(selected.id,parseInt(e.target.value))} style={{flex:1}}/>
              </div>
              {selected.ingredients.length>0&&<>
                <div style={{fontSize:12,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:tabBg,borderBottom:`1.5px solid ${kraft}`,paddingBottom:4,marginBottom:10,marginTop:20}}>Ingredients</div>
                {selected.ingredients.map((ing,i)=><div key={i} style={{fontSize:14,padding:"5px 0",borderBottom:`0.5px solid #e8d5a3`}}>{ratio!==1?scaleIngredient(ing,ratio):ing}</div>)}
              </>}
              {selected.instructions.length>0&&<>
                <div style={{fontSize:12,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:tabBg,borderBottom:`1.5px solid ${kraft}`,paddingBottom:4,marginBottom:10,marginTop:20}}>Instructions</div>
                {selected.instructions.map((step,i)=>{
                  const secs = extractTimerSeconds(step);
                  return (
                    <div key={i} style={{fontSize:14,padding:"6px 0",lineHeight:1.6,display:"flex",gap:10,borderBottom:`0.5px solid #e8d5a3`}}>
                      <div style={{minWidth:22,height:22,borderRadius:"50%",background:tabBg,color:cream,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:500,marginTop:2,flexShrink:0}}>{i+1}</div>
                      <div style={{flex:1}}>
                        <div>{step}</div>
                        {secs && <StepTimer key={`${selected.id}-${i}`} seconds={secs} stepText={step} kraft={kraft} tabBg={tabBg} cream={cream} darkBrown={darkBrown}/>}
                      </div>
                    </div>
                  );
                })}
              </>}
              {selected.storage&&<>
                <div style={{fontSize:12,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:tabBg,borderBottom:`1.5px solid ${kraft}`,paddingBottom:4,marginBottom:10,marginTop:20}}>Storage</div>
                <div style={{fontSize:14,lineHeight:1.7,color:darkBrown,background:"#f5f0e8",borderRadius:8,padding:"10px 14px"}}>{selected.storage}</div>
              </>}
              {selected.notes&&<>
                <div style={{fontSize:12,fontWeight:500,textTransform:"uppercase",letterSpacing:1.5,color:tabBg,borderBottom:`1.5px solid ${kraft}`,paddingBottom:4,marginBottom:10,marginTop:20}}>Notes</div>
                <div style={{fontSize:14,lineHeight:1.7,color:darkBrown,background:"#f5f0e8",borderRadius:8,padding:"10px 14px"}}>{selected.notes}</div>
              </>}
            </>
          )}
        </div>
      </div>
    );
  }

  // --- Recipe list view ---
  return (
    <div style={{fontFamily:font,background:cream,minHeight:"100vh",color:darkBrown,paddingBottom:40}}>
      <div style={{background:darkBrown,padding:"14px 16px 0",color:cream,position:"sticky",top:0,zIndex:100}}>
        <p style={{fontSize:22,fontWeight:500,margin:0,color:cream,letterSpacing:1}}>{APP_NAME}</p>
        <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>

          {/* Store buttons */}
          <div style={{position:"relative"}}>
            <button onClick={()=>{setStoreTab("mb");setView("shopping");}}
              style={{padding:"6px 14px",borderRadius:8,border:"none",background:MB_RED,color:"white",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:font,letterSpacing:0.3,boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}>
              🧺 Market Basket
            </button>
            {total>0&&<span style={{position:"absolute",top:-6,right:-6,background:"white",color:MB_RED,borderRadius:"50%",fontSize:10,width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,border:`1.5px solid ${MB_RED}`}}>{total>99?"99+":total}</span>}
          </div>
          <div style={{position:"relative"}}>
            <button onClick={()=>{setStoreTab("target");setView("shopping");}}
              style={{padding:"6px 14px",borderRadius:8,border:"none",background:"#cc0000",color:"white",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:font,letterSpacing:0.3,boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}>
              🎯 Target
            </button>
            {targetItems.length>0&&<span style={{position:"absolute",top:-6,right:-6,background:"white",color:"#cc0000",borderRadius:"50%",fontSize:10,width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,border:"1.5px solid #cc0000"}}>{targetItems.length>99?"99+":targetItems.length}</span>}
          </div>
          <div style={{position:"relative"}}>
            <button onClick={()=>{setStoreTab("lowes");setView("shopping");}}
              style={{padding:"6px 14px",borderRadius:8,border:"none",background:"#004990",color:"white",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:font,letterSpacing:0.3,boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}>
              🔨 Lowe's
            </button>
            {lowesItems.length>0&&<span style={{position:"absolute",top:-6,right:-6,background:"white",color:"#004990",borderRadius:"50%",fontSize:10,width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,border:"1.5px solid #004990"}}>{lowesItems.length>99?"99+":lowesItems.length}</span>}
          </div>

          {/* ── Import dropdown ── */}
          <div style={{position:"relative"}} ref={importDropdownRef}>
            <button
              onClick={()=>setShowImportDropdown(v=>!v)}
              style={{
                padding:"6px 12px",borderRadius:16,
                border:`1.5px solid ${kraft}`,
                background: showImportDropdown ? kraft : "transparent",
                color: showImportDropdown ? darkBrown : kraft,
                fontSize:12,cursor:"pointer",fontFamily:font,
                display:"flex",alignItems:"center",gap:5,
                transition:"background 0.15s, color 0.15s",
              }}>
              ＋ Import <span style={{fontSize:9,opacity:0.75,marginTop:1}}>{showImportDropdown?"▲":"▼"}</span>
            </button>
            {showImportDropdown&&(
              <div style={{
                position:"absolute",top:"calc(100% + 6px)",left:0,
                background:cream,border:`1.5px solid ${kraft}`,
                borderRadius:10,boxShadow:"0 6px 20px rgba(61,43,26,0.18)",
                zIndex:200,minWidth:155,overflow:"hidden",
              }}>
                {[
                  { icon:"📝", label:"Paste Text",  action:()=>{ setShowImport(true); setShowUrlImport(false); } },
                  { icon:"📷", label:"Photo",        action:()=>{ photoInputRef.current?.click(); } },
                  { icon:"🔗", label:"URL / Link",   action:()=>{ setShowUrlImport(true); setShowImport(false); } },
                ].map((opt, idx, arr) => (
                  <button
                    key={opt.label}
                    onClick={()=>{ setShowImportDropdown(false); opt.action(); }}
                    style={{
                      width:"100%",padding:"11px 15px",background:"transparent",border:"none",
                      borderBottom: idx < arr.length-1 ? `1px solid ${ringBg}` : "none",
                      textAlign:"left",fontSize:13,color:darkBrown,cursor:"pointer",
                      fontFamily:font,display:"flex",alignItems:"center",gap:9,
                    }}
                    onMouseEnter={e=>e.currentTarget.style.background=ringBg}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  >
                    <span style={{fontSize:15}}>{opt.icon}</span> {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoImport} style={{display:"none"}}/>
        </div>

        <div style={{display:"flex",overflowX:"auto",scrollbarWidth:"none"}}>
          {CATEGORIES.map(cat=>{const active=activeTab===cat;return <button key={cat} onClick={()=>setActiveTab(cat)} style={{padding:"7px 12px",fontSize:12,border:"none",cursor:"pointer",whiteSpace:"nowrap",borderRadius:"6px 6px 0 0",fontFamily:font,fontWeight:active?500:400,background:active?cream:tabBg,color:active?darkBrown:"#f5e6c8",marginRight:2}}>{cat}</button>;})}
        </div>
      </div>

      <div style={{padding:"10px 12px 0",display:"flex",gap:8,alignItems:"center"}}>
        <input placeholder="Search recipes or ingredients..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,padding:"8px 12px",borderRadius:20,border:`1.5px solid ${kraft}`,background:"#2a1c0e",color:cream,fontSize:14,outline:"none",fontFamily:font,boxSizing:"border-box"}}/>
        <button onClick={()=>setSortAZ(v=>!v)} style={{padding:"8px 12px",borderRadius:20,border:`1.5px solid ${kraft}`,background:"transparent",color:kraft,fontSize:12,cursor:"pointer",fontFamily:font,whiteSpace:"nowrap"}}>
          {sortAZ?"A→Z":"Z→A"}
        </button>
      </div>

      {/* ── Text import panel ── */}
      {showImport&&(
        <div style={{background:"#fffcf2",border:`1px solid ${kraft}`,borderRadius:8,margin:"10px 12px",padding:14}}>
          <p style={{fontSize:13,color:darkBrown,marginBottom:6,fontStyle:"italic"}}>Paste recipe text below — it will be saved to your cookbook.</p>
          <textarea value={importText} onChange={e=>setImportText(e.target.value)} style={{width:"100%",height:140,border:`1px solid ${kraft}`,borderRadius:6,padding:10,fontSize:13,fontFamily:font,background:cream,color:darkBrown,resize:"vertical",boxSizing:"border-box"}} placeholder={"Recipe Title\nCategory: Mains\nServings: 4\nIngredients:\n- ingredient\nInstructions:\n1. Step one"}/>
          <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
            <button onClick={()=>setShowImport(false)} style={{padding:"8px 14px",background:"transparent",color:darkBrown,border:`1px solid ${kraft}`,borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:font}}>Cancel</button>
            <button onClick={handleImport} style={{padding:"8px 18px",background:darkBrown,color:cream,border:"none",borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:font}}>Save to Cookbook</button>
          </div>
        </div>
      )}

      {/* ── URL import panel ── */}
      {showUrlImport&&(
        <div style={{background:"#fffcf2",border:`1px solid ${kraft}`,borderRadius:8,margin:"10px 12px",padding:14}}>
          {urlImporting?(
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{fontSize:26,marginBottom:8}}>🔗</div>
              <p style={{fontSize:14,color:tabBg,fontWeight:500}}>Fetching recipe from URL…</p>
              <p style={{fontSize:12,color:"#aaa"}}>This usually takes 5–15 seconds</p>
            </div>
          ):(
            <>
              <p style={{fontSize:13,color:darkBrown,marginBottom:8,fontStyle:"italic"}}>Paste a recipe URL and we'll extract it for you.</p>
              {urlImportError&&<p style={{fontSize:12,color:"#c0392b",marginBottom:8}}>⚠️ {urlImportError}</p>}
              <input
                value={urlImportValue}
                onChange={e=>setUrlImportValue(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleUrlImport()}
                placeholder="https://www.example.com/recipes/chicken-soup"
                style={{width:"100%",padding:"9px 12px",border:`1px solid ${kraft}`,borderRadius:6,fontSize:13,fontFamily:font,background:cream,color:darkBrown,boxSizing:"border-box",outline:"none"}}
              />
              <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end"}}>
                <button onClick={()=>{setShowUrlImport(false);setUrlImportValue("");setUrlImportError(null);}} style={{padding:"8px 14px",background:"transparent",color:darkBrown,border:`1px solid ${kraft}`,borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:font}}>Cancel</button>
                <button onClick={handleUrlImport} style={{padding:"8px 18px",background:darkBrown,color:cream,border:"none",borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:font}}>Import Recipe</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Photo import status panel ── */}
      {showPhotoImport&&(
        <div style={{background:"#fffcf2",border:`1px solid ${kraft}`,borderRadius:8,margin:"10px 12px",padding:14,textAlign:"center"}}>
          {photoImporting?(
            <>
              <div style={{fontSize:28,marginBottom:8}}>📷</div>
              <p style={{fontSize:14,color:tabBg,fontWeight:500}}>Reading recipe from photo…</p>
              <p style={{fontSize:12,color:"#aaa"}}>This usually takes 5–10 seconds</p>
            </>
          ):photoError?(
            <>
              <div style={{fontSize:28,marginBottom:8}}>⚠️</div>
              <p style={{fontSize:13,color:"#c0392b",marginBottom:8}}>{photoError}</p>
              <button onClick={()=>{setShowPhotoImport(false);setPhotoError(null);}} style={{padding:"8px 18px",background:darkBrown,color:cream,border:"none",borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:font}}>OK</button>
            </>
          ):null}
        </div>
      )}

      <div style={{padding:"12px 12px 0"}}>
        {filtered.length===0?(
          <p style={{textAlign:"center",padding:"40px 20px",color:"#8a6030",fontStyle:"italic"}}>{search?"No recipes match your search.":activeTab==="Favorites"?"No favorites yet.":"No recipes in this category yet."}</p>
        ):filtered.map(r=>{
          const isEditingSrv = editingServingsId === r.id;
          return (
            <div key={r.id} style={{background:"#fffcf2",border:`1px solid ${kraft}`,borderRadius:8,padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
              {/* Grocery checkbox */}
              <div onClick={e=>toggleCheck(r.id,e)} style={{width:22,height:22,borderRadius:4,border:`2px solid ${checkedIds.has(r.id)?tabBg:kraft}`,background:checkedIds.has(r.id)?tabBg:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,color:cream,fontSize:13,fontWeight:700}}>
                {checkedIds.has(r.id)?"✓":""}
              </div>

              {/* Title + category row — tappable to open recipe */}
              <div style={{flex:1,cursor:"pointer",minWidth:0}} onClick={()=>setSelectedId(r.id)}>
                <p style={{fontSize:15,fontWeight:500,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.title}</p>
                <p style={{fontSize:12,color:"#8a6030",marginTop:2,fontStyle:"italic"}}>{r.category}</p>
              </div>

              {/* Inline servings stepper */}
              <div onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",gap:3,flexShrink:0}}>
                <button
                  onClick={e=>{e.stopPropagation();setServings(r.id,r.servings-1);}}
                  style={{width:24,height:24,borderRadius:6,border:`1.5px solid ${kraft}`,background:"transparent",color:tabBg,fontSize:16,lineHeight:1,cursor:"pointer",fontFamily:font,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                  −
                </button>
                {isEditingSrv ? (
                  <input
                    ref={servingsInputRef}
                    type="number"
                    min={1}
                    value={editingServingsVal}
                    onChange={e=>setEditingServingsVal(e.target.value)}
                    onBlur={()=>commitServingsEdit(r.id)}
                    onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")commitServingsEdit(r.id);}}
                    style={{width:36,padding:"2px 4px",border:`1.5px solid ${tabBg}`,borderRadius:5,textAlign:"center",fontSize:13,fontFamily:font,background:cream,color:darkBrown,outline:"none"}}
                  />
                ) : (
                  <span
                    onClick={e=>openServingsEdit(e,r)}
                    title="Tap to type a value"
                    style={{minWidth:36,textAlign:"center",fontSize:13,fontWeight:600,color:darkBrown,cursor:"text",padding:"2px 4px",borderRadius:5,border:`1.5px solid transparent`,lineHeight:"20px",display:"inline-block"}}>
                    {r.servings}
                  </span>
                )}
                <button
                  onClick={e=>{e.stopPropagation();setServings(r.id,r.servings+1);}}
                  style={{width:24,height:24,borderRadius:6,border:`1.5px solid ${kraft}`,background:"transparent",color:tabBg,fontSize:16,lineHeight:1,cursor:"pointer",fontFamily:font,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                  ＋
                </button>
              </div>

              {/* Favorite star */}
              <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,flexShrink:0}} onClick={e=>toggleFav(r.id,e)}>{r.favorite?"★":"☆"}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
