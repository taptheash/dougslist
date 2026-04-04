import { useState, useMemo, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch
} from "firebase/firestore";

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

// Request notification permission
const requestNotificationPermission = async () => {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch(e) { /* silently fail */ }
};

const sendNotification = (title, body) => {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch(e) { /* silently fail — don't crash the app */ }
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
            try {
              sendNotification("⏱️ Timer Done!", stepText ? `Step complete: ${stepText.slice(0,60)}` : "Your cooking timer is done!");
            } catch(e) { /* silently fail */ }
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

const CATEGORIES = ["All","Favorites","Appetizers","Italian","Soups & Stews","Mains","Meats","Fish & Seafood","Sides","Desserts","Breads & Breakfast","Drinks","Other"];

const STORE_SECTIONS = [
  { key: "entrance", label: "🥖 Entrance — Artisan Bread", aisle: "Entrance" },
  { key: "produce", label: "🥦 Aisle 20 — Produce", aisle: "20" },
  { key: "meat", label: "🥩 Meat Counter", aisle: "AMeat" },
  { key: "deli", label: "🥪 Deli Counter", aisle: "ADeli" },
  { key: "frozen1", label: "🧊 Aisle 19 — Frozen Meals / Veg / Meats", aisle: "19" },
  { key: "frozen2", label: "🍕 Aisle 18 — Frozen Apps / Pizza", aisle: "18" },
  { key: "beverages2", label: "🍷 Aisle 17 — Beer / Wine", aisle: "17" },
  { key: "bread", label: "🍞 Aisle 16 — Bread / Crackers / PB", aisle: "16" },
  { key: "water", label: "💧 Aisle 14 — Water / Seltzers", aisle: "14" },
  { key: "soda", label: "🥤 Aisle 15 — Soda / Energy Drinks", aisle: "15" },
  { key: "snacks", label: "🍿 Aisle 13 — Chips", aisle: "13" },
  { key: "cleaning", label: "🧹 Aisle 12 — Cleaning / Laundry", aisle: "12" },
  { key: "pet", label: "🐾 Aisle 11 — Pet / Charcoal", aisle: "11" },
  { key: "health2", label: "🧴 Aisle 10 — Kleenex / Dove Bar Soap", aisle: "10" },
  { key: "health1", label: "💊 Aisle 9 — Health / Vitamins", aisle: "9" },
  { key: "kitchen", label: "🍳 Aisle 8 — Snacks / Kitchen", aisle: "8" },
  { key: "spices", label: "☕ Aisle 7 — Spices / Baking / Coffee", aisle: "7" },
  { key: "canned", label: "🥫 Aisle 6 — Canned Veg / Beans", aisle: "6" },
  { key: "pasta", label: "🍝 Aisle 5 — Pasta / Sauces / Rice", aisle: "5" },
  { key: "cereal", label: "🥣 Aisle 4 — Cereal", aisle: "4" },
  { key: "condiments", label: "🫙 Aisle 3 — Condiments / Oils / Marinades", aisle: "3" },
  { key: "eggs", label: "🍳 Aisle 2 — Eggs / Bacon / Soup / Fresh Pasta", aisle: "2" },
  { key: "seafood", label: "🦞 Seafood Counter", aisle: "ASeafood" },
  { key: "dairy", label: "🥛 Aisle 1 — Dairy (Last!)", aisle: "1" },
];

const TARGET_CATEGORIES = [
  { key: "grocery", label: "🛒 Grocery & Snacks" },
  { key: "health", label: "🧴 Health & Beauty" },
  { key: "cleaning", label: "🧹 Cleaning & Household" },
  { key: "clothing", label: "👕 Clothing" },
  { key: "home", label: "🏠 Home & Decor" },
  { key: "electronics", label: "🖥️ Electronics" },
  { key: "toys", label: "🧸 Toys & Entertainment" },
  { key: "pharmacy", label: "💊 Pharmacy" },
  { key: "pet", label: "🐾 Pet" },
  { key: "other", label: "📦 Other" },
];

const TARGET_KEYWORDS = {
  grocery: ["food","snack","chips","cereal","coffee","tea","water","juice","soda","bread","pasta","rice","sauce","soup","candy","chocolate","cookie","cracker","nut","granola","protein bar","frozen","drink","beverage"],
  health: ["shampoo","conditioner","soap","lotion","deodorant","toothpaste","toothbrush","floss","razor","makeup","skincare","sunscreen","body wash","hair"],
  cleaning: ["cleaner","detergent","bleach","sponge","mop","broom","trash bag","paper towel","napkin","foil","plastic wrap","ziploc","dish soap","laundry"],
  clothing: ["shirt","pants","jeans","dress","shoes","socks","underwear","jacket","coat","hat","gloves","scarf","boots","sneakers"],
  home: ["candle","picture frame","pillow","blanket","towel","curtain","rug","lamp","storage","basket","organizer","decor","vase","mirror"],
  electronics: ["phone","charger","cable","headphones","speaker","battery","tv","remote","computer","tablet","camera","printer"],
  toys: ["toy","game","puzzle","doll","lego","book","craft","art","play","kids","baby"],
  pharmacy: ["vitamin","supplement","medicine","ibuprofen","tylenol","advil","bandage","first aid","prescription","otc","melatonin","allergy"],
  pet: ["dog","cat","pet","treat","litter","leash","collar"],
};

const classifyTarget = (text) => {
  const lower = text.toLowerCase();
  for (const [key, kws] of Object.entries(TARGET_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) return key;
  }
  return "other";
};

const LOWES_CATEGORIES = [
  { key: "lumber", label: "🪵 Lumber & Building" },
  { key: "tools", label: "🔧 Tools & Hardware" },
  { key: "windows", label: "🪟 Doors & Windows" },
  { key: "paint", label: "🎨 Paint" },
  { key: "electrical", label: "🔌 Electrical" },
  { key: "plumbing", label: "🚰 Plumbing" },
  { key: "lawn", label: "🌿 Lawn & Garden" },
  { key: "flooring", label: "🏠 Flooring" },
  { key: "hvac", label: "❄️ Heating & Cooling" },
  { key: "other", label: "📦 Other" },
];

const LOWES_KEYWORDS = {
  lumber: ["wood","lumber","plywood","2x4","board","beam","post","framing","osb","drywall","insulation","sheathing","stud"],
  tools: ["hammer","drill","saw","screwdriver","wrench","pliers","level","tape measure","nail","screw","bolt","nut","washer","tool","sandpaper","chisel","clamp"],
  windows: ["window","door","screen","lock","handle","hinge","weatherstrip","threshold","garage door"],
  paint: ["paint","primer","stain","varnish","brush","roller","tray","tape","drop cloth","caulk","spackle","putty"],
  electrical: ["wire","outlet","switch","breaker","panel","conduit","junction box","light","bulb","led","fixture","plug","extension cord","electrical"],
  plumbing: ["pipe","faucet","valve","toilet","sink","drain","fitting","pvc","copper","shutoff","clog","sealant","plumbing","water heater"],
  lawn: ["mulch","soil","seed","fertilizer","plant","flower","tree","shrub","hose","sprinkler","mower","edger","trimmer","rake","shovel","garden"],
  flooring: ["floor","tile","hardwood","laminate","vinyl","carpet","grout","adhesive","underlayment","baseboard","trim","molding"],
  hvac: ["furnace","ac","filter","duct","vent","thermostat","hvac","heater","fan","heat pump"],
};

const classifyLowes = (text) => {
  const lower = text.toLowerCase();
  for (const [key, kws] of Object.entries(LOWES_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) return key;
  }
  return "other";
};


const KEYWORD_MAP = {
  entrance: ["sourdough","artisan bread","specialty bread","baguette"],
  produce: ["lettuce","spinach","kale","cabbage","tomato","tomatoes","onion","onions","garlic","carrot","carrots","celery","potato","potatoes","sweet potato","pepper","peppers","cucumber","zucchini","mushroom","mushrooms","broccoli","cauliflower","avocado","avocados","lime","lemon","limes","lemons","apple","banana","berries","cilantro","parsley","basil","ginger","jalapeno","scallion","shallot","corn","green onion","green beans","arugula","squash","asparagus","roma","fresh herb","cherry tomato"],
  meat: ["chicken","beef","pork","lamb","turkey","bacon","sausage","ham","steak","roast","ground beef","ground turkey","chuck","brisket","sirloin","bratwurst","hot dog","pepperoni","salami"],
  deli: ["sliced turkey","sliced ham","sliced chicken","roast beef","bologna","deli meat","deli cheese","provolone","swiss cheese","american cheese","muenster","pepper jack","colby","salt pork","prosciutto","pancetta"],
  frozen1: ["frozen vegetable","frozen meal","frozen meat","frozen chicken","frozen fish","frozen shrimp","frozen corn","frozen peas","frozen spinach","frozen broccoli","frozen dinner","frozen dumpling","dumpling"],
  frozen2: ["frozen pizza","frozen appetizer","frozen app","frozen snack","pizza rolls","hot pocket","egg rolls"],
  beverages2: ["wine","beer","champagne","cider","hard seltzer","ale","lager","ipa","prosecco","marsala","guinness","stout"],
  bread: ["bread","tortilla","tortillas","roll","bun","pita","bagel","english muffin","crackers","peanut butter","almond butter","nut butter","graham crackers","rice cakes","ritz"],
  water: ["water","seltzer","sparkling water","mineral water","tonic water","club soda"],
  soda: ["soda","cola","pepsi","coke","sprite","dr pepper","energy drink","gatorade","powerade","lemonade","iced tea","kombucha"],
  snacks: ["chips","popcorn","pretzels","trail mix","pork rinds","tortilla chips","snack mix","nuts","almonds","walnuts","cashews","peanuts","pecans"],
  cleaning: ["cleaning","laundry","detergent","bleach","dish soap","dishwasher","sponge","trash bag","garbage bag","ziploc","plastic bag","foil","aluminum foil","parchment","plastic wrap","paper towel","napkin"],
  pet: ["dog food","cat food","pet","dog treat","cat treat","charcoal","lighter fluid"],
  health2: ["kleenex","tissue","dove","softsoap","bar soap","body wash","shampoo","conditioner","lotion","deodorant","toothpaste","toothbrush","floss","razor","cotton"],
  health1: ["vitamin","supplement","medicine","ibuprofen","tylenol","advil","nyquil","bandage","first aid","melatonin","protein powder","probiotic","mouthwash","listerine","oral b"],
  kitchen: ["cooking spray","food storage"],
  spices: ["spices","cumin","paprika","oregano","cinnamon","turmeric","garlic powder","onion powder","chili powder","cayenne","red pepper flakes","italian seasoning","bay leaf","vanilla","baking soda","baking powder","flour","sugar","brown sugar","powdered sugar","cornstarch","yeast","cocoa","coffee","tea","thyme","rosemary","sage","marjoram","nutmeg","coriander","smoked paprika","kosher salt","sea salt","black pepper","white pepper"],
  canned: ["canned","can of","black beans","kidney beans","chickpeas","lentils","canned tomato","tomato sauce","canned corn","canned beans","canned vegetable","diced tomatoes","crushed tomatoes","coconut milk","evaporated milk","condensed milk","miso","white beans","cannellini beans"],
  pasta: ["pasta","spaghetti","penne","fettuccine","lasagna","macaroni","rice","quinoa","couscous","orzo","noodles","ramen","pasta sauce","marinara","alfredo","pesto","salsa","egg noodle","linguine","tortellini","ditalini","san marzano"],
  cereal: ["cereal","oatmeal","oats","granola","grits","cream of wheat","muesli","granola bar","protein bar"],
  condiments: ["ketchup","mustard","mayonnaise","mayo","soy sauce","worcestershire","hot sauce","sriracha","oyster sauce","fish sauce","hoisin","teriyaki","barbecue","bbq","ranch","honey","maple syrup","jam","jelly","relish","pickle","olive","capers","vinegar","balsamic","apple cider vinegar","tahini","hummus","salad dressing","marinade","lawry","tomato paste","dijon"],
  eggs: ["egg","eggs","bacon","soup","fresh pasta","quiche","chicken broth","beef broth","vegetable broth","broth","stock","bone broth","clam juice"],
  seafood: ["fish","salmon","tuna","shrimp","tilapia","cod","crab","lobster","scallop","anchovy","haddock","clam","clams","mussel","oyster","swordfish","halibut","mahi","sea bass","flounder"],
  dairy: ["milk","cream","sour cream","cream cheese","parmesan","mozzarella","cheddar","ricotta","half and half","heavy cream","buttermilk","cottage cheese","whipping cream","brie","gouda","feta","string cheese","yogurt","cheese","gruyere","cotija","pecorino","butter","pie crust","pie shell"],
};

const classifyIngredient = (ing) => {
  const lower = ing.toLowerCase();
  if (/shrimp|haddock|salmon|tuna|cod|tilapia|crab|lobster|scallop|clam|mussel|oyster|anchovy|swordfish|halibut|flounder|fish fillet/.test(lower)) return "seafood";
  if (/broth|stock|clam juice|bone broth/.test(lower)) return "eggs";
  if (/\beggs?\b|\bbacon\b/.test(lower)) return "eggs";
  if (/tomato paste|tomato sauce/.test(lower)) return "condiments";
  if (/frozen|dumpling/.test(lower)) return "frozen1";
  if (/pie crust|pie shell/.test(lower)) return "dairy";
  if (/\bbutter\b/.test(lower)) return "dairy";
  if (/dijon/.test(lower)) return "condiments";
  if (/oil/.test(lower)) return "condiments";
  if (/wine/.test(lower)) return "beverages2";
  const spiceKeys = KEYWORD_MAP["spices"] || [];
  if (spiceKeys.some(k => lower === k || lower.startsWith(k+" ") || lower.endsWith(" "+k) || lower.includes(" "+k+" "))) return "spices";
  if (/salt|pepper/.test(lower) && !/salt pork|bell pepper|red pepper flakes|black pepper/.test(lower)) return "spices";
  const condimentKeys = KEYWORD_MAP["condiments"] || [];
  if (condimentKeys.some(k => lower.includes(k))) return "condiments";
  for (const sec of STORE_SECTIONS) {
    if (["spices","condiments","frozen1","frozen2","seafood","eggs"].includes(sec.key)) continue;
    const kws = KEYWORD_MAP[sec.key] || [];
    if (kws.some(k => lower.includes(k))) return sec.key;
  }
  return "kitchen";
};

const PREP_STRIP = /,?\s*(diced|chopped|minced|sliced|crushed|peeled|grated|shredded|julienned|halved|quartered|cubed|trimmed|thawed|drained|rinsed|beaten|softened|melted|room temperature|coarsely|finely|thinly|roughly|freshly|packed|heaping|level|divided|optional|to taste|for serving|for garnish|for frying|as needed|or more|or less|hand-crushed|torn|zested and juiced|juiced|zested|deveined|pounded|cut into cubes|separated|crumbled|peeled and cubed|peeled and diced|cooked and shredded|thinly sliced|roughly chopped|finely chopped|lightly beaten|freshly grated|freshly ground)[^,]*/gi;
const COOK_WORDS = /\b(diced|chopped|minced|sliced|crushed|peeled|grated|shredded|cubed|trimmed|beaten|softened|melted|thawed|drained|rinsed|coarsely|finely|thinly|roughly|freshly|packed|heaping|divided|optional)\b/gi;
const SPICES_AND_PANTRY = ["salt","pepper","black pepper","white pepper","red pepper flakes","crushed red pepper","cayenne","chili powder","cumin","paprika","smoked paprika","oregano","italian seasoning","garlic powder","onion powder","cinnamon","turmeric","nutmeg","sage","thyme","rosemary","marjoram","bay leaf","coriander","allspice","cardamom","fennel","dill","curry powder","garam masala","old bay","baking soda","baking powder","cornstarch","yeast","vanilla extract","cocoa powder","sugar","brown sugar","powdered sugar","kosher salt","sea salt","flour","olive oil","vegetable oil","canola oil","coconut oil","sesame oil","garlic oil","soy sauce","worcestershire","fish sauce","hot sauce","sriracha","honey","maple syrup","vinegar","balsamic","apple cider vinegar","red wine vinegar","white wine vinegar","miso paste","tomato paste","chipotle","italian herbs","breadcrumbs","panko","dijon mustard","dijon"];

const MEAT_CONVERSIONS = [
  { match: /ground beef and pork/i, out: "ground beef and pork mix" },
  { match: /ground beef/i, out: "ground beef" },
  { match: /ground pork/i, out: "ground pork" },
  { match: /ground turkey/i, out: "ground turkey" },
  { match: /chuck roast/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb chuck roast` },
  { match: /chuck steak/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb chuck steak` },
  { match: /pork butt/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb pork butt` },
  { match: /beef sirloin|sirloin/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb beef sirloin` },
  { match: /stew beef/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb stew beef` },
  { match: /chicken breast/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb chicken breasts` },
  { match: /chicken breast/i, unit: /(\d+)\s*chicken/i, out: (a) => `${a} chicken breasts` },
  { match: /chicken thigh/i, unit: /(\d+)\s*chicken/i, out: (a) => `${a} chicken thighs` },
  { match: /chicken thigh/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb chicken thighs` },
  { match: /\bchicken\b/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb chicken` },
  { match: /haddock/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb haddock` },
  { match: /shrimp/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb shrimp` },
  { match: /sausage/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb sausage` },
  { match: /\bbeef\b/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (a) => `${a} lb beef` },
];

const PRODUCE_CONVERSIONS = [
  { match: /garlic/i, unit: /(\d+)\s*clove/i, out: () => "1 head garlic" },
  { match: /garlic/i, unit: /(\d*\.?\d+)\s*(tsp|tbsp|cup)/i, out: () => "1 head garlic" },
  { match: /garlic/i, unit: /(\d+)\s*garlic/i, out: () => "1 head garlic" },
  { match: /green onion|scallion/i, unit: /(\d+)/i, out: (n) => `${n} green onion${n>1?"s":""}` },
  { match: /onion/i, unit: /(\d*\.?\d+)\s*cup/i, out: (_,a) => a<=0.5?"1 small onion":a<=1?"1 medium onion":"2 medium onions" },
  { match: /onion/i, unit: /(\d+)\s*(large|medium|small)?\s*onion/i, out: (n,_,m) => `${n} ${m[2]?m[2]+" ":""}onion${n>1?"s":""}` },
  { match: /onion/i, unit: /(\d+)/i, out: (n) => `${n} onion${n>1?"s":""}` },
  { match: /lemon/i, unit: /(\d*\.?\d+)\s*(tbsp|tsp)/i, out: () => "1 lemon" },
  { match: /lemon/i, unit: /(\d+)\s*lemon/i, out: (n) => `${n} lemon${n>1?"s":""}` },
  { match: /lime/i, unit: /(\d*\.?\d+)\s*(tbsp|tsp)/i, out: () => "1 lime" },
  { match: /lime/i, unit: /(\d+)\s*lime/i, out: (n) => `${n} lime${n>1?"s":""}` },
  { match: /orange/i, unit: /(\d+)\s*orange/i, out: (n) => `${n} orange${n>1?"s":""}` },
  { match: /cherry tomato/i, unit: /(\d+)/i, out: (n) => `${n} cherry tomatoes` },
  { match: /roma tomato/i, unit: /(\d+)/i, out: (n) => `${n} roma tomatoes` },
  { match: /tomato/i, unit: /(\d+)\s*(large|medium|small)?\s*tomato/i, out: (n,_,m) => `${n} ${m[2]?m[2]+" ":""}tomato${n>1?"es":""}` },
  { match: /celery/i, unit: /(\d+)\s*stalk/i, out: (n) => `${n} stalk${n>1?"s":""} celery` },
  { match: /celery/i, unit: /(\d*\.?\d+)\s*cup/i, out: () => "1 bunch celery" },
  { match: /celery/i, unit: /(\d+)/i, out: (n) => `${n} stalk${n>1?"s":""} celery` },
  { match: /carrot/i, unit: /(\d+)\s*carrot/i, out: (n) => `${n} carrot${n>1?"s":""}` },
  { match: /carrot/i, unit: /(\d*\.?\d+)\s*cup/i, out: (_,a) => a<=1?"2 carrots":"4 carrots" },
  { match: /carrot/i, unit: /(\d+)/i, out: (n) => `${n} carrot${n>1?"s":""}` },
  { match: /red bell pepper|yellow bell pepper|green bell pepper|bell pepper/i, unit: /(\d+)/i, out: (n,_,__,raw) => { const c=(raw||"").match(/red|yellow|green/i); return `${n} ${c?c[0]+" ":""}bell pepper${n>1?"s":""}`; } },
  { match: /poblano/i, unit: /(\d+)/i, out: (n) => `${n} poblano${n>1?"s":""}` },
  { match: /jalapeno/i, unit: /(\d+)/i, out: (n) => `${n} jalapeno${n>1?"s":""}` },
  { match: /avocado/i, unit: /(\d+)/i, out: (n) => `${n} avocado${n>1?"s":""}` },
  { match: /mango/i, unit: /(\d+)/i, out: (n) => `${n} mango${n>1?"es":""}` },
  { match: /zucchini/i, unit: /(\d+)/i, out: (n) => `${n} zucchini` },
  { match: /cilantro|parsley|basil/i, unit: /(\d*\.?\d+)\s*(tbsp|tsp|cup|cups|bunch|bunches)/i, out: (_,__,___,raw) => { const h=(raw||"").match(/cilantro|parsley|basil/i); return `1 bunch ${h?h[0]:"herbs"}`; } },
  { match: /cilantro|parsley|basil/i, unit: /(\d+)/i, out: (_,__,___,raw) => { const h=(raw||"").match(/cilantro|parsley|basil/i); return `1 bunch ${h?h[0]:"herbs"}`; } },
  { match: /potato/i, unit: /(\d*\.?\d+)\s*(lb|lbs)/i, out: (_,a) => `${a} lb potatoes` },
  { match: /potato/i, unit: /(\d+)\s*potato/i, out: (n) => `${n} potato${n>1?"es":""}` },
  { match: /potato/i, unit: /(\d+)/i, out: (n) => `${n} potatoes` },
  { match: /mushroom/i, unit: /(\d+)\s*oz/i, out: (n) => `${n} oz mushrooms` },
  { match: /mushroom/i, unit: /(\d*\.?\d+)\s*cup/i, out: (_,a) => a<=1?"8 oz mushrooms":"16 oz mushrooms" },
  { match: /spinach|kale|arugula/i, unit: /(\d*\.?\d+)\s*cup/i, out: (_,a,__,raw) => { const l=(raw||"").match(/spinach|kale|arugula/i); return `${a<=2?"5 oz":"10 oz"} ${l?l[0]:"spinach"}`; } },
];

const toShoppingText = (raw) => {
  const lower = raw.toLowerCase();
  if (lower.includes("wine")) return raw.replace(/^[\d\s./]+\s*(cup|cups|tbsp|tsp|oz|ml|l)?\s*/i, "").replace(PREP_STRIP, "").trim();
  if (lower.includes("frozen")) return raw.trim();
  if (lower.includes("broth") || lower.includes("stock")) {
    if (lower.includes("chicken broth")) return "chicken broth";
    if (lower.includes("beef broth")) return "beef broth";
    if (lower.includes("vegetable broth")) return "vegetable broth";
    if (lower.includes("bone broth")) return "bone broth";
    return "broth";
  }
  for (const sp of SPICES_AND_PANTRY) {
    if (lower.includes(sp)) {
      const cleaned = raw.replace(/^[\d\s./]+\s*(tbsp|tsp|cup|cups|oz|pinch|dash|g|kg|ml|lb|lbs)?\s*/i, "").replace(PREP_STRIP, "").replace(COOK_WORDS, "").replace(/\s{2,}/g, " ").replace(/,\s*$/, "").trim();
      return cleaned || sp;
    }
  }
  for (const rule of MEAT_CONVERSIONS) {
    if (rule.match.test(lower)) {
      if (rule.unit) { const m = raw.match(rule.unit); if (m) return rule.out(parseFloat(m[1])); }
      else { const am = raw.match(/(\d*\.?\d+)\s*(lb|lbs)/i); return am ? `${parseFloat(am[1])} lb ${rule.out}` : String(rule.out); }
    }
  }
  for (const rule of PRODUCE_CONVERSIONS) {
    if (rule.match.test(lower)) {
      const um = raw.match(rule.unit);
      if (um) { const qty = parseFloat(um[1])||1; const result = rule.out(qty, qty, um, raw); if (result) return result; }
    }
  }
  let cleaned = raw.replace(PREP_STRIP, "").replace(/,\s*$/, "").trim();
  cleaned = cleaned.replace(COOK_WORDS, "").replace(/\s{2,}/g, " ").replace(/,\s*$/, "").trim();
  return cleaned || raw;
};

const parseAmount = (text) => {
  const m = text.match(/^([\d./\s]+)\s*(lb|lbs|oz|can|cans|cup|cups|tbsp|tsp|clove|cloves|stalk|stalks|head|heads|bunch|bunches|piece|pieces)?\s*(.+)/i);
  if (!m) return { qty: null, unit: null, name: text.trim().toLowerCase() };
  const rawQty = m[1].trim();
  let qty = rawQty.includes('/') ? rawQty.split('/').reduce((a,b)=>parseFloat(a)/parseFloat(b)) : parseFloat(rawQty);
  if (isNaN(qty)) return { qty: null, unit: null, name: text.trim().toLowerCase() };
  const unitMap = { lbs:"lb",lb:"lb",oz:"oz",can:"can",cans:"can",cup:"cup",cups:"cup",tbsp:"tbsp",tsp:"tsp",clove:"clove",cloves:"clove",stalk:"stalk",stalks:"stalk",head:"head",heads:"head",bunch:"bunch",bunches:"bunch" };
  return { qty, unit: unitMap[(m[2]||"").toLowerCase()] || (m[2]||"").toLowerCase(), name: m[3].trim().toLowerCase() };
};

const formatQty = (qty) => {
  if (!qty) return "";
  const r = Math.round(qty*4)/4, w = Math.floor(r), f = r-w;
  const fs = f===0.25?"1/4":f===0.5?"1/2":f===0.75?"3/4":"";
  if (w===0) return fs; if (fs) return `${w} ${fs}`; return `${w}`;
};

// Produce sub-section ordering — matches Doug's path through the produce section
const PRODUCE_ORDER = [
  // Onions / Garlic / Potatoes
  "onion","onions","garlic","shallot","scallion","green onion","potato","potatoes","sweet potato","ginger",
  // Broccoli area
  "broccoli","cauliflower","cabbage","kale","arugula","lettuce","celery","carrot","carrots","corn","green beans","squash","zucchini","cucumber","pepper","peppers","jalapeno","poblano","tomato","tomatoes","cherry tomato","roma","fresh herb","cilantro","parsley","basil","thyme","rosemary",
  // Asparagus area
  "asparagus",
  // Apples
  "apple",
  // Bananas
  "banana",
  // Berries / citrus
  "berries","lime","lemon","limes","lemons","orange",
  // Mushrooms
  "mushroom","mushrooms",
  // Spinach / Avocado
  "spinach","avocado","avocados",
];

const produceSubSort = (items) => {
  return [...items].sort((a, b) => {
    const aText = a.text.toLowerCase();
    const bText = b.text.toLowerCase();
    const aIdx = PRODUCE_ORDER.findIndex(k => aText.includes(k));
    const bIdx = PRODUCE_ORDER.findIndex(k => bText.includes(k));
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
};


const combineItems = (items) => {
  const groups = {};
  items.forEach(item => {
    const p = parseAmount(item.text);
    const unit = p.unit||"";
    const key = p.name+"|"+unit;
    if (!groups[key]) groups[key] = { ...item, parsed:p, unit, totalQty:p.qty||0, count:1, recipes:[item.recipe] };
    else { groups[key].totalQty += (p.qty||0); groups[key].count += 1; if (!groups[key].recipes.includes(item.recipe)) groups[key].recipes.push(item.recipe); }
  });
  return Object.values(groups).map(g => {
    let displayText;
    if (!g.parsed.qty || g.count===1) displayText = g.text;
    else { const qs=formatQty(g.totalQty); const u=g.unit?` ${g.unit}`:""; displayText=`${qs}${u} ${g.parsed.name}`.trim(); }
    return { ...g, text:displayText, recipeList:g.recipes };
  });
};

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
    return { id:`seed_${i}`, title, category:validCat, baseServings:servings, servings, ingredients, instructions, favorite:false };
  }).filter(Boolean);
};

const scaleIngredient = (line, ratio) => line.replace(/(\d+\.?\d*\/?\d*)/g, match => {
  if (match.includes("/")) { const [n,d]=match.split("/").map(Number); const v=(n/d)*ratio; return v%1===0?v.toString():v.toFixed(2).replace(/\.?0+$/,""); }
  const v=parseFloat(match)*ratio; if(v%1===0) return v.toString(); return v.toFixed(2).replace(/\.?0+$/,"");
});

const SAMPLE = `Shepherd's Pie
Category: Mains
Servings: 6
Ingredients:
- 1.5 lb ground beef
- 1 onion
- 2 carrots
- 1 celery stalk
- 8 oz mushrooms
- 2 tbsp tomato paste
- 1 tbsp Worcestershire sauce
- 1 tsp thyme
- 1.5 cups beef broth
- 2 lbs potatoes
- 4 tbsp butter
- 0.5 cup milk
- Salt and pepper to taste
Instructions:
1. Boil potatoes until tender. Drain and mash with butter and milk. Season with salt and pepper.
2. Preheat oven to 400F.
3. Dice onion, carrots, and celery. Slice mushrooms.
4. Brown ground beef in a skillet. Drain fat.
5. Add vegetables and cook until soft, about 5 minutes.
6. Stir in tomato paste, Worcestershire sauce, and thyme.
7. Add beef broth and simmer 10 minutes until thickened.
8. Pour filling into a baking dish and top with mashed potatoes.
9. Bake 20 to 25 minutes until golden. Rest before serving.

Beef Stroganoff
Category: Mains
Servings: 4
Ingredients:
- 1.5 lb beef sirloin or stew beef
- 8 oz mushrooms
- 1 onion
- 2 garlic cloves
- 2 tbsp butter
- 2 tbsp flour
- 1 cup beef broth
- 1 tbsp Worcestershire sauce
- 1 tsp Dijon mustard
- 1 cup sour cream
- 12 oz egg noodles
- Salt and pepper to taste
Instructions:
1. Cook egg noodles according to package directions. Drain and set aside.
2. Season beef with salt and pepper. Sear in butter over high heat until browned. Remove and set aside.
3. In the same pan cook onion and mushrooms until softened about 5 minutes.
4. Add garlic and cook 1 minute.
5. Stir in flour and cook 1 minute.
6. Add beef broth Worcestershire sauce and Dijon mustard. Stir and simmer until slightly thickened about 5 minutes.
7. Remove from heat and stir in sour cream until smooth.
8. Return beef to the pan and toss to combine.
9. Serve over egg noodles.

Chicken Pot Pie
Category: Mains
Servings: 6
Ingredients:
- 1 lb chicken breast
- 2 carrots
- 2 celery stalks
- 1 onion
- 1 cup frozen peas
- 4 tbsp butter
- 3 tbsp flour
- 2 cups chicken broth
- 1 cup milk
- 1 tsp thyme
- Salt and pepper to taste
- 2 pie crusts
Instructions:
1. Preheat oven to 425F.
2. Cook and shred chicken. Set aside.
3. Melt butter in a large skillet over medium heat. Cook onion carrots and celery until softened about 5 minutes.
4. Stir in flour and cook 1 minute.
5. Gradually add chicken broth and milk stirring constantly until thickened.
6. Add chicken peas thyme salt and pepper. Stir to combine.
7. Line a 9-inch pie dish with one crust. Pour in filling.
8. Top with second crust crimp edges and cut vents in the top.
9. Bake 30-35 minutes until crust is golden brown.
10. Rest 10 minutes before serving.

Classic Beef Chili
Category: Mains
Servings: 6
Ingredients:
- 1.5 lb ground beef
- 2 cans kidney beans
- 1 can diced tomatoes
- 3 tbsp tomato paste
- 1 onion
- 3 garlic cloves
- 2 tbsp chili powder
- 1 tsp cumin
- Salt and pepper to taste
Instructions:
1. Brown ground beef in a large pot over medium-high heat. Drain excess fat.
2. Add onion and garlic; cook 3 minutes until softened.
3. Stir in tomato paste, chili powder, and cumin; cook 1 minute.
4. Add diced tomatoes and beans. Simmer uncovered for 30 minutes.
5. Season with salt and pepper. Serve with toppings of your choice.

Lemon Garlic Pasta
Category: Mains
Servings: 4
Ingredients:
- 12 oz spaghetti
- 4 tbsp olive oil
- 4 garlic cloves
- 1 lemon
- 0.5 cup parmesan
- 0.25 cup fresh parsley
- 0.5 tsp red pepper flakes
- Salt and pepper to taste
Instructions:
1. Cook spaghetti in salted boiling water until al dente. Reserve 1 cup pasta water.
2. Heat olive oil in a pan over medium. Add garlic and red pepper flakes; saute 2 minutes.
3. Add lemon zest and juice. Toss in drained pasta with a splash of pasta water.
4. Remove from heat; fold in parmesan and parsley.
5. Season and serve immediately.

Shrimp Scampi
Category: Fish & Seafood
Servings: 4
Ingredients:
- 1 lb large shrimp
- 4 tbsp butter
- 2 tbsp olive oil
- 4 garlic cloves
- 0.5 cup dry white wine
- 1 lemon
- 0.25 tsp red pepper flakes
- Salt to taste
- 2 tbsp fresh parsley
- 8 oz linguine
Instructions:
1. Cook pasta until al dente. Reserve pasta water then drain.
2. Season shrimp with salt.
3. Heat olive oil and 2 tbsp butter in a large skillet over medium heat.
4. Add garlic and cook 30 seconds until fragrant.
5. Add shrimp and cook 1-2 minutes per side until pink. Remove and set aside.
6. Add wine to the pan. Simmer 2-3 minutes.
7. Stir in remaining butter, lemon juice, and red pepper flakes.
8. Return shrimp to the pan and toss to coat.
9. Add pasta plus a splash of pasta water. Finish with parsley and serve.

Michael's of Brooklyn Style Marinara Sauce
Category: Mains
Servings: 5
Ingredients:
- 0.25 cup olive oil
- 6 garlic cloves
- 2 cans San Marzano whole peeled tomatoes (28 oz)
- 1 tsp kosher salt
- 0.5 tsp sugar
- 9 fresh basil leaves
- 0.25 tsp crushed red pepper flakes
Instructions:
1. Crush tomatoes by hand until slightly chunky.
2. Heat olive oil over medium-low heat.
3. Add garlic and cook gently 1-2 minutes.
4. Add tomatoes carefully.
5. Add salt and red pepper flakes.
6. Simmer uncovered 30-40 minutes.
7. Adjust seasoning and finish with basil.

Chicken Parmesan
Category: Meats
Servings: 4
Ingredients:
- 3 chicken breasts
- 0.5 cup flour
- 2 eggs
- 0.5 cup grated Parmesan
- 0.5 cup breadcrumbs
- Salt to taste
- Olive oil to taste
- Marinara sauce to taste
- 1 cup mozzarella
Instructions:
1. Pound chicken evenly and salt.
2. Dredge each cutlet in flour then egg with Parmesan then breadcrumb coating.
3. Fry in olive oil until golden on both sides.
4. Transfer to a baking dish. Add marinara and top with mozzarella.
5. Bake at 400F for 10-15 minutes.
6. Broil to finish until cheese is bubbly and lightly browned.

Italian Chicken Rice and Vegetable Bake
Category: Meats
Servings: 7
Ingredients:
- 2 cups rice
- 3 cups broth
- 1 cup milk
- 1.5 lbs chicken
- 1 onion
- 2 carrots
- 2 celery stalks
- 1 cup mushrooms
- 1 red pepper
- 3 garlic cloves
- Italian seasoning to taste
- Salt and pepper to taste
- Parmesan to taste
- Mozzarella to taste
Instructions:
1. Saute onion, carrots, celery, mushrooms, red pepper, and garlic until softened.
2. Mix sauteed vegetables with rice, broth, milk, chicken, and seasonings in a large baking dish.
3. Cover and bake at 350F for 55 minutes.
4. Uncover, top with Parmesan and mozzarella, and bake an additional 15-20 minutes.
5. Rest before serving.

Garlic Butter Chicken Thighs
Category: Mains
Servings: 4
Ingredients:
- 6 chicken thighs
- 1.5 cups rice
- 3.75 cups broth
- 1 cup mushrooms
- 1 red pepper
- 2 tbsp butter
- 1 tbsp olive oil
- 3 garlic cloves
- Salt to taste
Instructions:
1. Sear chicken thighs in olive oil and butter until golden. Remove and set aside.
2. Cook mushrooms and red pepper in the same pan until softened.
3. Add garlic and cook 1 minute.
4. Stir in rice and broth scraping up any browned bits.
5. Return chicken thighs on top.
6. Simmer covered until rice is cooked and chicken is done through.
7. Finish with a pat of butter before serving.

Chicken Marsala
Category: Mains
Servings: 4
Ingredients:
- 2 chicken breasts
- Salt to taste
- 0.5 cup flour
- 2 tbsp olive oil
- 2 tbsp butter
- 8 oz mushrooms
- 3 garlic cloves
- 0.75 cup Marsala wine
- 0.5 cup chicken broth
Instructions:
1. Pound chicken to even thickness and season with salt.
2. Dredge in flour shaking off excess.
3. Sear chicken in olive oil and butter until golden on both sides. Remove and set aside.
4. Cook mushrooms in the same pan until browned.
5. Add garlic and cook 1 minute.
6. Add Marsala wine and reduce by half.
7. Add chicken broth and simmer 3-4 minutes.
8. Return chicken to the pan and cook through spooning sauce over top.

Pan Fried Honey Lemon Chicken
Category: Mains
Servings: 4
Ingredients:
- 1.5 lbs chicken breasts
- 0.5 cup flour
- 2 tbsp olive oil
- 2 tbsp butter
- 3 garlic cloves
- 3 tbsp honey
- 2 tbsp soy sauce
- 2 tbsp lemon juice
Instructions:
1. Dredge chicken in flour and fry in olive oil until golden and cooked through. Remove and set aside.
2. Add butter and garlic to the pan; cook 1 minute.
3. Stir in honey, soy sauce, and lemon juice. Simmer until slightly thickened.
4. Return chicken to the pan and toss to coat in the glaze. Serve immediately.

Spaghetti Pomodoro
Category: Mains
Servings: 4
Ingredients:
- 12 oz spaghetti
- 1 can San Marzano tomatoes (28 oz)
- 4 tbsp olive oil
- 3 garlic cloves
- 8 fresh basil leaves
- Salt to taste
Instructions:
1. Cook pasta in salted boiling water until al dente. Reserve pasta water.
2. Heat olive oil in a pan over medium. Add garlic and cook until fragrant.
3. Add tomatoes crushing them as they go in. Simmer 15-20 minutes until sauce thickens.
4. Season with salt. Toss drained pasta in the sauce with a splash of pasta water.
5. Finish with torn fresh basil and a drizzle of olive oil.

Cheese Tortellini Carbonara
Category: Mains
Servings: 4
Ingredients:
- 18 oz cheese tortellini
- 4 oz pancetta
- 2 eggs
- 2 egg yolks
- 1 cup Pecorino Romano or Parmesan
- Black pepper to taste
Instructions:
1. Cook pancetta in a skillet over medium until crispy. Remove from heat.
2. Cook tortellini in salted boiling water. Reserve 1 cup pasta water before draining.
3. Whisk eggs yolks and cheese together. Season generously with black pepper.
4. Working off heat add drained tortellini to the pancetta pan. Pour egg mixture over tossing quickly.
5. Add pasta water a splash at a time tossing until sauce is creamy.

New England Clam Chowder
Category: Soups & Stews
Servings: 6
Ingredients:
- 4 oz salt pork
- 1 onion
- 3 potatoes
- 2 cups clam juice
- 1 cup milk
- 1 cup heavy cream
- 2 cups clams
- Salt and pepper to taste
Instructions:
1. Render salt pork in a large pot over medium heat until crispy.
2. Add onion and cook until softened.
3. Add potatoes and clam juice. Simmer until potatoes are tender about 15 minutes.
4. Stir in clams and cook 3-4 minutes.
5. Reduce heat and add milk and cream. Heat gently do not boil.
6. Season with salt and pepper. Serve hot.

French Onion Soup Dobbin House Tavern Style
Category: Soups & Stews
Servings: 7
Ingredients:
- 4 large onions
- 4 tbsp butter
- 1 tbsp olive oil
- 6 cups beef broth
- 0.5 cup dry white wine
- Salt to taste
- 1 loaf French bread
- Gruyere cheese to taste
Instructions:
1. Melt butter and olive oil together in a large pot over low heat.
2. Add onions and cook very slowly for about 2 hours until deeply caramelized.
3. Add wine and cook 2-3 minutes.
4. Add broth and simmer 20-30 minutes. Season with salt.
5. Ladle into oven-safe bowls and top with toasted bread and Gruyere.
6. Broil until cheese is melted and browned.

Slow-Cooker Vegetable Minestrone
Category: Soups & Stews
Servings: 7
Ingredients:
- 1 onion
- 2 carrots
- 2 celery stalks
- 1 can kidney beans
- 1 can cannellini beans
- 1 can diced tomatoes
- 6 cups vegetable broth
- 1 zucchini
- 2 cups spinach
- 1 cup small pasta
- Italian seasoning to taste
- Salt to taste
Instructions:
1. Add onion carrots celery beans diced tomatoes broth and seasonings to the slow cooker.
2. Cook on low 6-8 hours.
3. In the last 30 minutes add pasta zucchini and spinach.
4. Cook until pasta is tender. Adjust seasoning and serve.

Guinness Beef Stew
Category: Soups & Stews
Servings: 6
Ingredients:
- 2 lbs beef chuck
- 2 carrots
- 2 celery stalks
- 1 onion
- 3 potatoes
- 2 tbsp tomato paste
- 1 bottle Guinness stout
- 2 cups beef broth
- Salt to taste
Instructions:
1. Brown beef in batches over high heat. Remove and set aside.
2. Add vegetables and cook 5 minutes until softened.
3. Stir in tomato paste and cook 1-2 minutes.
4. Pour in Guinness and broth scraping up browned bits.
5. Return beef to the pot. Simmer on low 2-3 hours until meat is very tender.
6. Season with salt and serve.

Pasta e Fagioli Slow Cooker
Category: Soups & Stews
Servings: 7
Ingredients:
- 1 onion
- 2 carrots
- 2 celery stalks
- 2 cans cannellini beans
- 1 can diced tomatoes
- 6 cups broth
- 1 cup small pasta
- Italian seasoning to taste
Instructions:
1. Add all ingredients except pasta to the slow cooker.
2. Cook on low 6-8 hours.
3. Add pasta in the last 30 minutes.
4. Cook until pasta is tender. Adjust seasoning and serve.

Miso Dumpling Bone Broth Soup
Category: Soups & Stews
Servings: 4
Ingredients:
- 4 cups bone broth
- 1 tbsp miso paste
- 12 frozen dumplings
- 2 green onions
- Soy sauce to taste
Instructions:
1. Heat bone broth in a pot over medium until simmering.
2. Add frozen dumplings and cook until tender about 6-8 minutes.
3. Remove from heat and stir in miso paste until dissolved.
4. Add soy sauce to taste.
5. Garnish with sliced green onion and serve.

Roast Chili No Beans Smoked Chuck Version
Category: Soups & Stews
Servings: 7
Ingredients:
- 2.5 lbs chuck roast
- Dried ancho chiles to taste
- Dried guajillo chiles to taste
- 3 garlic cloves
- 1 onion
- 2 cups beef broth
- 2 tbsp tomato paste
- Cumin to taste
- Oregano to taste
- Salt to taste
Instructions:
1. Rehydrate dried chiles in hot water. Blend with garlic into a smooth paste.
2. Smoke or sear chuck roast until well browned.
3. Combine beef chile paste onion tomato paste broth and spices in a large pot.
4. Simmer on low 2-3 hours until meat is very tender.
5. Shred meat stir back in and adjust seasoning before serving.

Triple-Chile Firehouse Beef and Bean Chili
Category: Soups & Stews
Servings: 7
Ingredients:
- 1 lb ground beef
- 1 onion
- 2 jalapenos
- 1 can kidney beans
- 1 can black beans
- 1 can diced tomatoes
- Chipotle pepper to taste
- Cayenne to taste
- Chili powder to taste
- Cumin to taste
Instructions:
1. Brown ground beef with onion and jalapenos until cooked through.
2. Add beans and diced tomatoes. Stir to combine.
3. Add chipotle cayenne chili powder and cumin to taste.
4. Simmer on low 1-2 hours until thick and flavorful.
5. Adjust seasoning and serve.

Award-Winning Beef and Sausage Chili Half Batch
Category: Soups & Stews
Servings: 5
Ingredients:
- 1 lb ground beef
- 0.5 lb hot Italian sausage
- Hatch chiles to taste
- 2 jalapenos
- 1 can beans
- Chili seasoning to taste
Instructions:
1. Brown ground beef and sausage together until cooked through. Drain excess fat.
2. Add Hatch chiles and jalapenos; cook 2-3 minutes.
3. Add beans and chili seasoning. Stir to combine.
4. Simmer on low until thick and flavorful about 45-60 minutes.

Lemon Garlic Baked Haddock
Category: Fish & Seafood
Servings: 2
Ingredients:
- 1 lb haddock fillets
- 2 tbsp olive oil
- 2 garlic cloves
- 1 lemon
- 0.25 cup Parmesan
- Salt to taste
Instructions:
1. Preheat oven to 400F.
2. Place haddock in a baking dish and season with salt.
3. Top with minced garlic lemon juice and lemon zest.
4. Drizzle with olive oil and sprinkle Parmesan on top.
5. Bake until fish is flaky and internal temp reaches 130-135F.

Lemon Caper Haddock
Category: Fish & Seafood
Servings: 2
Ingredients:
- 1 lb haddock fillets
- 2 garlic cloves
- 2 tbsp capers
- 1 lemon
- 2 tbsp butter
- 2 tbsp fresh parsley
- Salt to taste
Instructions:
1. Saute garlic in a pan over medium heat until fragrant.
2. Add capers and lemon juice. Stir to combine.
3. Place fish in a baking dish and spoon sauce over top. Bake at 400F until done.
4. Finish with butter and fresh parsley before serving.

Trial Baked Haddock Ritz Cracker Style
Category: Fish & Seafood
Servings: 2
Ingredients:
- 1 lb haddock fillets
- 24 Ritz crackers
- 3 tbsp Parmesan
- 4 tbsp butter
- Salt to taste
Instructions:
1. Preheat oven to 400F.
2. Crush Ritz crackers into coarse crumbs.
3. Mix crumbs with melted butter and Parmesan.
4. Place haddock in a buttered baking dish and season lightly with salt.
5. Top with the cracker mixture.
6. Bake 12-14 minutes then broil briefly until topping is golden and crisp.

Jimmy Dean-Style Breakfast Sausage
Category: Breads & Breakfast
Servings: 4
Ingredients:
- 1 lb ground pork
- 1 tsp dried sage
- 0.5 tsp dried thyme
- 1 tsp salt
- 0.5 tsp black pepper
- 1 tsp sugar
- 0.125 tsp nutmeg
- 0.25 tsp red pepper flakes
- 1.5 tbsp cold water
Instructions:
1. Combine all ingredients in a bowl.
2. Mix lightly until just combined.
3. Refrigerate at least 1 hour overnight preferred.
4. Cook in a skillet over medium heat breaking into small crumbles.
5. Add a splash of water while cooking to help create a loose texture.

Finnish Pancakes Blender Crepes
Category: Breads & Breakfast
Servings: 4
Ingredients:
- 1 cup milk
- 1 cup flour
- 2 eggs
- 1 tbsp sugar
- 1 tsp vanilla extract
- 1 pinch salt
- Butter for pan
Instructions:
1. Blend all ingredients until smooth.
2. Let batter rest 15-30 minutes.
3. Heat a lightly buttered pan over medium heat.
4. Pour a thin layer of batter and cook until lightly golden on the bottom.
5. Flip and cook briefly on the other side.

Sheet-Pan Chicken Thighs and Roasted Vegetables
Category: Mains
Servings: 4
Ingredients:
- 5 chicken thighs
- 2 potatoes
- 2 carrots
- 1 onion
- 2 tbsp olive oil
- Salt and pepper to taste
- Italian seasoning to taste
Instructions:
1. Preheat oven to 400F.
2. Toss vegetables with olive oil and seasoning. Spread on a sheet pan.
3. Roast vegetables for 20 minutes.
4. Add chicken thighs to the pan and roast another 35-40 minutes until cooked through.

Chicken Cacciatore
Category: Mains
Servings: 4
Ingredients:
- 4 chicken thighs
- 1 onion
- 1 red bell pepper
- 1 yellow bell pepper
- 8 oz mushrooms
- 3 garlic cloves
- 0.5 cup dry white wine
- 1 can diced tomatoes (14 oz)
- Italian seasoning to taste
Instructions:
1. Brown chicken thighs on both sides. Remove and set aside.
2. Saute onion peppers and mushrooms until softened.
3. Add garlic and cook 1 minute.
4. Add wine and reduce by half.
5. Add tomatoes and Italian seasoning. Stir to combine.
6. Return chicken to the pan. Simmer covered for 45 minutes until tender.

Garlic Paprika Chicken Thighs
Category: Mains
Servings: 4
Ingredients:
- 6 chicken thighs
- 2 garlic cloves
- 1 tsp paprika
- 1 onion
- Salt to taste
Instructions:
1. Season chicken thighs with salt and paprika.
2. Sear in a skillet over medium-high heat until browned on both sides.
3. Add onion and garlic to the pan.
4. Continue cooking over medium heat until chicken is fully cooked through and onions are soft.

Garlic Parmesan Baked Chicken Thighs
Category: Mains
Servings: 4
Ingredients:
- 6 chicken thighs
- 2 tbsp olive oil
- 1 tsp garlic powder
- 0.5 tsp onion powder
- 1 tsp Italian seasoning
- 0.5 cup Parmesan
Instructions:
1. Preheat oven to 400F.
2. Toss chicken thighs with olive oil garlic powder onion powder and Italian seasoning.
3. Place in a baking dish in a single layer.
4. Top generously with Parmesan.
5. Bake until cooked through and lightly browned about 35-40 minutes.

Chicken and Broccoli Pasta
Category: Mains
Servings: 4
Ingredients:
- 2 chicken breasts
- 8 oz pasta
- 1 cup broccoli florets
- 1 cup mushrooms
- 0.25 cup sun-dried tomatoes
- 2 tbsp garlic oil
- 2 tbsp butter
Instructions:
1. Cook pasta in salted boiling water until al dente. Reserve 1 cup pasta water then drain.
2. Cook chicken in garlic oil until done through. Slice and set aside.
3. Saute mushrooms and broccoli until tender.
4. Add sun-dried tomatoes and stir briefly.
5. Add pasta butter and a splash of pasta water. Toss to combine.
6. Add chicken back in toss again and serve.

Braised Chuck Steak with San Marzano Tomatoes and Thyme
Category: Mains
Servings: 5
Ingredients:
- 2 lbs chuck steak
- 1 onion
- 2 carrots
- 2 celery stalks
- 8 oz mushrooms
- 3 garlic cloves
- 1 cup beef broth
- 0.5 cup red wine
- 1 can San Marzano tomatoes (14 oz)
- Fresh thyme to taste
- Fresh rosemary to taste
- Salt to taste
Instructions:
1. Season beef generously and sear until well browned on all sides. Remove and set aside.
2. Saute onion carrots celery and mushrooms until softened.
3. Add garlic and cook 1 minute.
4. Deglaze with red wine and reduce by half.
5. Add tomatoes and broth. Stir to combine.
6. Return beef add herbs cover tightly and braise on low heat for 2-3 hours.

Chicken Breasts with White Beans Spinach and Cherry Tomatoes
Category: Mains
Servings: 4
Ingredients:
- 2 chicken breasts
- 1 can white beans
- 1 cup cherry tomatoes
- 2 cups spinach
- 2 garlic cloves
- 2 tbsp olive oil
- Salt to taste
Instructions:
1. Season chicken and cook in olive oil until done through. Remove and set aside.
2. Saute garlic and cherry tomatoes in the same pan until tomatoes begin to burst.
3. Add white beans and spinach; cook until spinach is wilted.
4. Return chicken to the pan combine and serve.

Italian Braised Chicken with Sofrito and Tomatoes
Category: Mains
Servings: 5
Ingredients:
- 6 chicken thighs
- 1 onion
- 1 carrot
- 1 celery stalk
- 8 oz mushrooms
- 3 garlic cloves
- 0.5 cup dry white wine
- 1 can San Marzano tomatoes (28 oz)
- Italian herbs to taste
Instructions:
1. Brown chicken thighs on both sides. Remove and set aside.
2. Cook onion carrot and celery slowly over low heat until softened about 10 minutes.
3. Add garlic and wine; reduce by half.
4. Add tomatoes and herbs. Stir to combine.
5. Return chicken cover and braise over low heat until very tender about 45-60 minutes.

New England Whoopie Pies
Category: Desserts
Servings: 9
Ingredients:
- 2 cups flour
- 0.5 cup cocoa powder
- 1 cup sugar
- 1 egg
- 0.5 cup vegetable oil
- 1 cup milk
- 1 tsp baking soda
Instructions:
1. Mix wet ingredients together until combined.
2. Add dry ingredients and stir until a smooth batter forms.
3. Scoop rounds onto a lined baking sheet.
4. Bake at 350F until set about 10-12 minutes.
5. Cool completely then sandwich pairs together with vanilla filling.

Rick McCarten Spicy Queso
Category: Appetizers
Servings: 7
Ingredients:
- 2 roasted poblanos
- 1 can roasted tomatoes (14 oz)
- 1 lime
- 2 garlic cloves
- 1 lb American cheese
- 1 cup mozzarella
- 0.5 cup cotija cheese
Instructions:
1. Blend tomatoes poblanos lime juice and garlic until smooth.
2. Let blended mixture rest overnight in the refrigerator.
3. Melt American cheese and mozzarella slowly over low heat stirring constantly.
4. Stir in the blended poblano-tomato mixture.
5. Cook on low stirring until smooth and fully combined. Fold in cotija before serving.

Roasted Poblano Queso with Fresh Blender Salsa
Category: Appetizers
Servings: 7
Ingredients:
- 2 poblanos
- 1 can roasted tomatoes (14 oz)
- 1 lime
- 2 garlic cloves
- 1 lb American cheese
- 1 cup mozzarella
- 0.5 cup cotija cheese
Instructions:
1. Roast poblanos under broiler until charred on all sides. Peel seed and roughly chop.
2. Blend roasted poblanos with tomatoes lime juice and garlic until smooth.
3. Let blended mixture rest overnight in the refrigerator.
4. Melt American cheese and mozzarella slowly over low heat stirring constantly.
5. Stir in the blended mixture until smooth and combined. Fold in cotija before serving.

Award-Winning Meatballs Jar Sauce Upgrade Version
Category: Mains
Servings: 5
Ingredients:
- 1 lb ground beef and pork mix
- 0.5 cup breadcrumbs
- 0.5 cup milk
- 1 egg
- 0.25 cup Parmesan
- 2 garlic cloves
- 1 tbsp Worcestershire sauce
Instructions:
1. Combine all ingredients gently.
2. Form into meatballs about 1.5 inches in diameter.
3. Brown in a skillet over medium-high heat on all sides.
4. Transfer to a pot of simmering marinara sauce.
5. Simmer covered until meatballs are cooked through about 20-25 minutes.

Weathervane-Style Onion Rings Quarter Batch
Category: Sides
Servings: 2
Ingredients:
- 1 large onion
- 0.5 cup flour
- 0.5 cup beer
- Salt to taste
- Oil for frying
Instructions:
1. Slice onion into rings and separate.
2. Mix flour and beer together into a smooth batter.
3. Heat oil in a pot or deep skillet to 375F.
4. Dip rings into batter and fry until golden brown.
5. Drain on paper towels and salt immediately.

BLT Steak Gruyere Popovers
Category: Breads & Breakfast
Servings: 4
Ingredients:
- 2 eggs
- 1 cup milk
- 1 cup flour
- 0.5 tsp salt
- 1 cup Gruyere cheese
- Cooked steak to taste
- Cooked bacon to taste
Instructions:
1. Preheat oven to 425F. Grease a popover pan well.
2. Whisk together eggs milk flour and salt until smooth.
3. Pour batter into the prepared popover pan filling each cup about halfway.
4. Bake at 425F for 20 minutes then reduce heat to 350F and bake 15-20 more minutes.
5. Fill with sliced steak bacon and Gruyere before serving.

Citrus-Marinated Boston Pork Butt with Mango Mojo
Category: Mains
Servings: 7
Ingredients:
- 6 lbs pork butt
- 1 lemon
- 1 orange
- 1 lime
- 4 garlic cloves
- 1 tsp cumin
- 1 tsp dried oregano
- 3 tbsp olive oil
- 1 onion
- 1 cup chicken stock
- 1 mango
- 1 jalapeno
Instructions:
1. Combine citrus zest and juice garlic cumin oregano and olive oil into a marinade. Coat pork butt well and marinate overnight.
2. Place sliced onions in a roasting pan and set pork on top. Pour chicken stock around the base.
3. Roast at 325F until very tender and falling apart about 4-5 hours.
4. Blend or mix mango and jalapeno with a squeeze of lime juice to make the mojo.
5. Slice or pull pork and serve with mango mojo spooned over top.

Pastrami with Chuck Roast
Category: Mains
Servings: 7
Ingredients:
- 3.5 lbs chuck roast
- Water for brine
- Salt for brine
- Sugar for brine
- Prague powder for brine
- Coriander for rub
- Black pepper for rub
Instructions:
1. Prepare brine and submerge chuck roast. Brine for 7-10 days refrigerated.
2. Rinse thoroughly and soak in cold water to remove excess salt.
3. Pat dry and apply coriander and black pepper rub generously.
4. Smoke low and slow until internal temp reaches 205F.
5. Rest well before slicing thin.`;

export default function App() {
  const MB_RED="#c8102e",MB_DARK="#a00d24",cream="#fdf6e3",kraft="#c8a96e",darkBrown="#3d2b1a",tabBg="#b5924a",ringBg="#e8d5a3",font="'Trebuchet MS', Helvetica, sans-serif";

  // --- State ---
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Shopping state - persisted in Firestore
  const [checkedIds, setCheckedIds] = useState(new Set());       // recipe IDs checked for shopping
  const [checkedItems, setCheckedItems] = useState(new Set());   // individual item keys checked off
  const [manualItems, setManualItems] = useState([]);            // freeform grocery items
  const [removedKeys, setRemovedKeys] = useState(new Set());
  const [manualInput, setManualInput] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [view, setView] = useState("recipes");
  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);
  const [wakeLock, setWakeLock] = useState(null);
  const [wakeActive, setWakeActive] = useState(false);

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
  // Store tab: "mb" | "target" | "lowes"
  const [storeTab, setStoreTab] = useState("mb");
  // Target list state
  const [targetItems, setTargetItems] = useState([]);
  const [targetChecked, setTargetChecked] = useState(new Set());
  const [targetInput, setTargetInput] = useState("");
  const [targetQty, setTargetQty] = useState("");
  const [targetCountdown, setTargetCountdown] = useState(null);
  const targetTimerRef = useRef(null);
  const targetResetAtRef = useRef(null);
  // Lowes list state
  const [lowesItems, setLowesItems] = useState([]);
  const [lowesChecked, setLowesChecked] = useState(new Set());
  const [lowesInput, setLowesInput] = useState("");
  const [lowesQty, setLowesQty] = useState("");
  const [lowesCountdown, setLowesCountdown] = useState(null);
  const lowesTimerRef = useRef(null);
  const lowesResetAtRef = useRef(null);

  // --- Load recipes from Firestore, seed if empty ---
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "recipes"), async (snap) => {
      if (snap.empty && !seeded) {
        setSeeded(true);
        const seedRecipes = parseRecipes(SAMPLE);
        const batch = writeBatch(db);
        seedRecipes.forEach(r => {
          batch.set(doc(db, "recipes", r.id), {
            title: r.title, category: r.category, baseServings: r.baseServings,
            servings: r.servings, ingredients: r.ingredients, instructions: r.instructions, favorite: false
          });
        });
        await batch.commit();
      } else {
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data(), servings: d.data().servings || d.data().baseServings }));
        setRecipes(loaded);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // --- Load shopping state from Firestore ---
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "app", "shopping"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCheckedIds(new Set(data.checkedIds || []));
        setCheckedItems(new Set(data.checkedItems || []));
        setManualItems(data.manualItems || []);
        setRemovedKeys(new Set(data.removedKeys || []));
        // Restore countdown if timer was running before refresh
        if (data.resetAt && !timerRef.current) {
          const rem = data.resetAt - Date.now();
          if (rem <= 0) {
            // Expired while app was closed — clear everything
            setDoc(doc(db, "app", "shopping"), { checkedIds:[], checkedItems:[], manualItems:[], removedKeys:[], resetAt:null }, { merge: true });
            setCheckedIds(new Set()); setCheckedItems(new Set()); setManualItems([]); setRemovedKeys(new Set());
          } else {
            resetAtRef.current = data.resetAt;
            timerRef.current = setInterval(() => {
              const r = data.resetAt - Date.now();
              if (r <= 0) { resetShopping(); return; }
              const m = Math.floor(r/60000), s = Math.floor((r%60000)/1000);
              setCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
            }, 1000);
          }
        }
      }
      shoppingLoaded.current = true;
    });
    return () => unsub();
  }, []);

  // --- Persist shopping state to Firestore ---
  const saveShoppingState = (updates) => {
    setDoc(doc(db, "app", "shopping"), updates, { merge: true });
  };

  // --- Load Target list from Firestore ---
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

  // --- Load Lowes list from Firestore ---
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
              if (r <= 0) { resetLowes(); return; }
              const m = Math.floor(r/60000), s = Math.floor((r%60000)/1000);
              setLowesCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
            }, 1000);
          }
        }
      }
    });
    return () => unsub();
  }, []);

  // --- Auto-reset timer for Target ---
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

  // --- Auto-reset timer for Lowes ---
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
    setTargetInput("");
    setTargetQty("");
  };

  const toggleTargetItem = (key) => {
    setTargetChecked(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
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
    setTargetItems([]); setTargetChecked(new Set());
    setTargetCountdown(null);
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
    setLowesInput("");
    setLowesQty("");
  };

  const toggleLowesItem = (key) => {
    setLowesChecked(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
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
    setLowesItems([]); setLowesChecked(new Set());
    setLowesCountdown(null);
    if (lowesTimerRef.current) { clearInterval(lowesTimerRef.current); lowesTimerRef.current = null; }
    lowesResetAtRef.current = null;
    setDoc(doc(db, "app", "lowes"), { items: [], checked: [], resetAt: null });
  };

  // --- Computed shopping items ---
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
  const activeSections=STORE_SECTIONS.filter(s=>grouped[s.key]?.length>0);
  const barColor=pct===100?"#22c55e":pct>=66?"#84cc16":"#ffe066";

  // --- Auto-reset timer ---
  const resetAtRef = useRef(null);
  useEffect(() => {
    if (total>0&&checked===total) {
      if (timerRef.current) return;
      // Save resetAt to Firebase so it persists across refreshes
      const end = resetAtRef.current || Date.now()+60*60*1000;
      resetAtRef.current = end;
      saveShoppingState({ resetAt: end });
      timerRef.current=setInterval(()=>{
        const rem=end-Date.now();
        if (rem<=0){resetShopping();return;}
        const m=Math.floor(rem/60000),s=Math.floor((rem%60000)/1000);
        setCountdown(`↺ Auto-reset in ${m}:${String(s).padStart(2,"0")}`);
      },1000);
    } else {
      if (timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
      resetAtRef.current = null;
      setCountdown(null);
    }
  }, [checked, total]);

  // --- Handlers ---
  const resetShopping = () => {
    const empty = { checkedIds:[], checkedItems:[], manualItems:[], removedKeys:[], resetAt:null };
    setCheckedIds(new Set()); setCheckedItems(new Set()); setManualItems([]); setRemovedKeys(new Set());
    setEditingKey(null);
    if (timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    resetAtRef.current = null;
    setCountdown(null);
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

  const toggleItem = (key) => {
    setCheckedItems(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      saveShoppingState({ checkedItems: [...n] });
      return n;
    });
  };

  const removeItem = (key) => {
    setRemovedKeys(prev => {
      const n = new Set(prev);
      n.add(key);
      saveShoppingState({ removedKeys: [...n] });
      return n;
    });
    setCheckedItems(prev => {
      const n = new Set(prev);
      n.delete(key);
      saveShoppingState({ checkedItems: [...n] });
      return n;
    });
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
    setManualInput("");
    setManualQty("");
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    const nr = parseRecipes(importText);
    if (nr.length) {
      const batch = writeBatch(db);
      nr.forEach((r, i) => {
        const id = `recipe_${Date.now()}_${i}`;
        batch.set(doc(db, "recipes", id), {
          title: r.title, category: r.category, baseServings: r.baseServings,
          servings: r.servings, ingredients: r.ingredients, instructions: r.instructions, favorite: false
        });
      });
      await batch.commit();
      setImportText(""); setShowImport(false);
    }
  };

  const startEditRecipe = (r) => {
    setEditDraft({title:r.title,category:r.category,ingredients:r.ingredients.join("\n"),instructions:r.instructions.join("\n")});
    setEditingRecipeId(r.id);
  };

  const saveEditRecipe = async (id) => {
    await updateDoc(doc(db,"recipes",id), {
      title: editDraft.title.trim(),
      category: editDraft.category,
      ingredients: editDraft.ingredients.split("\n").map(l=>l.replace(/^[-*•]\s*/,"").trim()).filter(Boolean),
      instructions: editDraft.instructions.split("\n").map(l=>l.replace(/^\d+[.)]\s*/,"").trim()).filter(Boolean),
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
    return list;
  }, [recipes, activeTab, search]);

  const selected = recipes.find(r=>r.id===selectedId);

  if (loading) return (
    <div style={{fontFamily:font,background:cream,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:darkBrown}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:12}}>📖</div>
        <div style={{fontSize:16,color:tabBg}}>Loading dougslist…</div>
      </div>
    </div>
  );

  // --- Shopping view ---
  if (view==="shopping") {
    const TARGET_RED = "#cc0000";
    const LOWES_BLUE = "#004990";

    // Store tab colors
    const storeColor = storeTab === "mb" ? MB_RED : storeTab === "target" ? TARGET_RED : LOWES_BLUE;
    const storeDark = storeTab === "mb" ? MB_DARK : storeTab === "target" ? "#990000" : "#003370";
    const storeName = storeTab === "mb" ? "Market Basket · Merchants Way" : storeTab === "target" ? "Target" : "Lowe's / Home Depot";

    // Target grouped
    const targetGrouped = {};
    TARGET_CATEGORIES.forEach(c => targetGrouped[c.key] = []);
    targetItems.forEach(item => { (targetGrouped[item.category] || targetGrouped["other"]).push(item); });
    const targetActiveCats = TARGET_CATEGORIES.filter(c => targetGrouped[c.key]?.length > 0);
    const targetTotal = targetItems.length;
    const targetCheckedCount = targetItems.filter(i => targetChecked.has(i.key)).length;
    const targetPct = targetTotal > 0 ? Math.round((targetCheckedCount / targetTotal) * 100) : 0;

    // Lowes grouped
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
        {/* Header */}
        <div style={{background:storeColor,color:"white",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:12,opacity:0.85}}>{storeName}</div>
            <div style={{fontSize:20,fontWeight:700,letterSpacing:0.5}}>🛒 Shopping List</div>
          </div>
          <button onClick={storeTab==="mb"?resetShopping:storeTab==="target"?resetTarget:resetLowes}
            style={{background:storeDark,color:"white",border:"none",borderRadius:6,padding:"6px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:font}}>Reset</button>
        </div>

        {/* Progress bar */}
        <div style={{background:storeDark,height:14,position:"relative"}}>
          <div style={{background:currentBarColor,height:14,width:currentPct+"%",transition:"width 0.4s ease"}}/>
          {currentPct>8&&<span style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",fontSize:10,fontWeight:700,color:currentPct>45?"#1a1a1a":"#fff8f0"}}>{currentPct}%</span>}
        </div>

        {/* Count bar */}
        <div style={{background:"#fff8f0",padding:"8px 20px",fontSize:13,color:"#555",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #e0e0d8"}}>
          <span><strong style={{color:storeColor}}>{currentChecked}</strong> of <strong style={{color:storeColor}}>{currentTotal}</strong> items &nbsp;
            <span style={{color:"#aaa",fontSize:12}}>{currentTotal-currentChecked>0?`· ${currentTotal-currentChecked} remaining`:"· all done!"}</span>
          </span>
          {storeTab==="mb"&&countdown&&<span style={{color:storeColor,fontWeight:600,fontSize:12}}>{countdown}</span>}
          {storeTab==="target"&&targetCountdown&&<span style={{color:storeColor,fontWeight:600,fontSize:12}}>{targetCountdown}</span>}
          {storeTab==="lowes"&&lowesCountdown&&<span style={{color:storeColor,fontWeight:600,fontSize:12}}>{lowesCountdown}</span>}
          <button onClick={()=>setView("recipes")} style={{background:"transparent",border:`1px solid ${storeColor}`,color:storeColor,borderRadius:6,padding:"4px 12px",fontSize:12,cursor:"pointer",fontFamily:font}}>← Back</button>
        </div>

        {/* Market Basket list */}
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
                {activeSections.map(sec=>(
                  <div key={sec.key} style={{margin:"10px 16px 0"}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:"#888",padding:"6px 4px 4px",borderBottom:"1px solid #ddd",marginBottom:4}}>{sec.label}</div>
                    {grouped[sec.key].map(item=>{
                      const done=checkedItems.has(item.key);
                      const isEditingThis=editingKey===item.key;
                      const recipeNames=item.recipeList||[item.recipe];
                      return (
                        <div key={item.key} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 10px",background:"white",borderRadius:8,marginBottom:5,border:"1px solid #eee",opacity:done?0.5:1}}>
                          <div onClick={()=>toggleItem(item.key)} style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${done?MB_RED:"#ccc"}`,background:done?MB_RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",marginTop:3}}>
                            {done&&<span style={{color:"white",fontSize:11,fontWeight:700}}>✓</span>}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            {isEditingThis?(
                              <input autoFocus value={editingText} onChange={e=>setEditingText(e.target.value)}
                                onKeyDown={e=>{if(e.key==="Enter")saveEdit(item.key);if(e.key==="Escape")setEditingKey(null);}}
                                onBlur={()=>saveEdit(item.key)}
                                style={{width:"100%",fontSize:14,padding:"3px 8px",border:`1.5px solid ${MB_RED}`,borderRadius:6,fontFamily:font,outline:"none",boxSizing:"border-box"}}/>
                            ):(
                              <>
                                <div onClick={()=>toggleItem(item.key)} style={{fontSize:15,textDecoration:done?"line-through":"none",color:done?"#aaa":"#222",cursor:"pointer"}}>{item.text}</div>
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
              </div>
            )}
          </div>
        )}

        {/* Target list */}
        {storeTab==="target"&&(
          <div>
            <div style={{padding:"10px 16px 0"}}>
              <div style={{display:"flex",gap:8}}>
                <input type="number" min={1} max={99} value={targetQty} onChange={e=>setTargetQty(e.target.value)} onBlur={e=>setTargetQty(v=>parseInt(v)||"")} placeholder="1" style={{width:52,padding:"8px 6px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white",textAlign:"center"}}/>
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

        {/* Lowes list */}
        {storeTab==="lowes"&&(
          <div>
            <div style={{padding:"10px 16px 0"}}>
              <div style={{display:"flex",gap:8}}>
                <input type="number" min={1} max={99} value={lowesQty} onChange={e=>setLowesQty(e.target.value)} onBlur={e=>setLowesQty(v=>parseInt(v)||"")} placeholder="1" style={{width:52,padding:"8px 6px",borderRadius:8,border:"1px solid #ddd",fontSize:14,fontFamily:font,background:"white",textAlign:"center"}}/>
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
          <p style={{fontSize:22,fontWeight:500,margin:0,color:cream}}>dougslist</p>
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
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Ingredients <span style={{fontSize:10,color:"#aaa",textTransform:"none",letterSpacing:0}}>(one per line)</span></label>
                <textarea value={editDraft.ingredients} onChange={e=>setEditDraft(d=>({...d,ingredients:e.target.value}))} style={{...inpStyle,height:180,resize:"vertical",lineHeight:1.6}}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:1.2,color:tabBg,display:"block",marginBottom:4}}>Instructions <span style={{fontSize:10,color:"#aaa",textTransform:"none",letterSpacing:0}}>(one step per line)</span></label>
                <textarea value={editDraft.instructions} onChange={e=>setEditDraft(d=>({...d,instructions:e.target.value}))} style={{...inpStyle,height:220,resize:"vertical",lineHeight:1.6}}/>
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
            </>
          )}
        </div>
      </div>
    );
  }

  // --- Recipe list view ---
  return (
    <div style={{fontFamily:font,background:cream,minHeight:"100vh",color:darkBrown,paddingBottom:40}}>
      <div style={{background:darkBrown,padding:"14px 16px 0",color:cream}}>
        <p style={{fontSize:22,fontWeight:500,margin:0,color:cream,letterSpacing:1}}>dougslist</p>
        <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
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
          <button onClick={()=>setShowImport(v=>!v)} style={{padding:"6px 14px",borderRadius:16,border:`1.5px solid ${kraft}`,background:"transparent",color:kraft,fontSize:12,cursor:"pointer",fontFamily:font}}>+ Import Recipe</button>
        </div>
        <div style={{display:"flex",overflowX:"auto",scrollbarWidth:"none"}}>
          {CATEGORIES.map(cat=>{const active=activeTab===cat;return <button key={cat} onClick={()=>setActiveTab(cat)} style={{padding:"7px 12px",fontSize:12,border:"none",cursor:"pointer",whiteSpace:"nowrap",borderRadius:"6px 6px 0 0",fontFamily:font,fontWeight:active?500:400,background:active?cream:tabBg,color:active?darkBrown:"#f5e6c8",marginRight:2}}>{cat}</button>;})}
        </div>
      </div>
      <div style={{padding:"10px 12px 0"}}>
        <input placeholder="Search recipes or ingredients..." value={search} onChange={e=>setSearch(e.target.value)} style={{width:"100%",padding:"8px 12px",borderRadius:20,border:`1.5px solid ${kraft}`,background:"#2a1c0e",color:cream,fontSize:14,outline:"none",fontFamily:font,boxSizing:"border-box"}}/>
      </div>
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
      <div style={{padding:"12px 12px 0"}}>
        {filtered.length===0?(
          <p style={{textAlign:"center",padding:"40px 20px",color:"#8a6030",fontStyle:"italic"}}>{search?"No recipes match your search.":activeTab==="Favorites"?"No favorites yet.":"No recipes in this category yet."}</p>
        ):filtered.map(r=>(
          <div key={r.id} style={{background:"#fffcf2",border:`1px solid ${kraft}`,borderRadius:8,padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
            <div onClick={e=>toggleCheck(r.id,e)} style={{width:22,height:22,borderRadius:4,border:`2px solid ${checkedIds.has(r.id)?tabBg:kraft}`,background:checkedIds.has(r.id)?tabBg:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,color:cream,fontSize:13,fontWeight:700}}>
              {checkedIds.has(r.id)?"✓":""}
            </div>
            <div style={{flex:1,cursor:"pointer"}} onClick={()=>setSelectedId(r.id)}>
              <p style={{fontSize:15,fontWeight:500,margin:0}}>{r.title}</p>
              <p style={{fontSize:12,color:"#8a6030",marginTop:2,fontStyle:"italic"}}>{r.category} · {r.servings} servings</p>
            </div>
            <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18}} onClick={e=>toggleFav(r.id,e)}>{r.favorite?"★":"☆"}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
