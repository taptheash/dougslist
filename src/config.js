// dougslist config — your personal settings
// Change these to customize the app for your household

export const APP_NAME = "dougslist";
export const GROCERY_STORE_NAME = "Market Basket · Merchants Way";

// AFTER:
export const CATEGORIES = [
  "All", "Favorites", "Appetizers", "Italian", "Soups & Stews",
  "Mains", "Meats", "Fish & Seafood", "Vegetables", "Sides", "Desserts",
  "Breads & Breakfast", "Drinks", "Other"
];

export const STORE_SECTIONS = [
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

export const TARGET_CATEGORIES = [
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

export const TARGET_KEYWORDS = {
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

export const classifyTarget = (text) => {
  const lower = text.toLowerCase();
  for (const [key, kws] of Object.entries(TARGET_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) return key;
  }
  return "other";
};

export const LOWES_CATEGORIES = [
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

export const LOWES_KEYWORDS = {
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

export const classifyLowes = (text) => {
  const lower = text.toLowerCase();
  for (const [key, kws] of Object.entries(LOWES_KEYWORDS)) {
    if (kws.some(k => lower.includes(k))) return key;
  }
  return "other";
};

export const KEYWORD_MAP = {
  entrance: ["sourdough","artisan bread","specialty bread","baguette"],
  produce: ["lettuce","spinach","kale","cabbage","tomato","tomatoes","onion","onions","garlic","carrot","carrots","celery","potato","potatoes","sweet potato","pepper","peppers","cucumber","zucchini","mushroom","mushrooms","broccoli","cauliflower","avocado","avocados","lime","lemon","limes","lemons","apple","banana","berries","kiwi","cilantro","parsley","basil","ginger","jalapeno","scallion","shallot","corn","green onion","green beans","arugula","squash","asparagus","roma","fresh herb","cherry tomato"],
  meat: ["chicken","beef","pork","lamb","turkey","bacon","sausage","ham","steak","roast","ground beef","ground turkey","chuck","brisket","sirloin","bratwurst","hot dog","pepperoni","salami"],
  deli: ["sliced turkey","sliced ham","sliced chicken","roast beef","bologna","deli meat","deli cheese","provolone","swiss cheese","american cheese","muenster","pepper jack","colby","salt pork","prosciutto","pancetta"],
  frozen1: ["frozen vegetable","frozen meal","frozen meat","frozen chicken","frozen fish","frozen shrimp","frozen corn","frozen peas","frozen spinach","frozen broccoli","frozen dinner","frozen dumpling","dumpling"],
  frozen2: ["frozen pizza","frozen appetizer","frozen app","frozen snack","pizza rolls","hot pocket","egg rolls","veggie burger","vegetable burger","garden burger","black bean burger","turkey burger"],
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
  spices: ["spices","cumin","paprika","oregano","cinnamon","turmeric","garlic powder","onion powder","chili powder","cayenne","red pepper flakes","italian seasoning","bay leaf","vanilla","baking soda","baking powder","flour","sugar","brown sugar","powdered sugar","cornstarch","yeast","cocoa","coffee","tea","thyme","rosemary","sage","marjoram","nutmeg","coriander","smoked paprika","kosher salt","sea salt","black pepper","white pepper","slivered almonds","sliced almonds","anise","anise seed","anise seeds","star anise"],
  canned: ["canned","can of","black beans","kidney beans","chickpeas","lentils","canned tomato","tomato sauce","canned corn","canned beans","canned vegetable","diced tomatoes","crushed tomatoes","coconut milk","evaporated milk","condensed milk","miso","white beans","cannellini beans","tuna","canned tuna"],
  pasta: ["pasta","spaghetti","penne","fettuccine","lasagna","macaroni","rice","quinoa","couscous","orzo","noodles","ramen","pasta sauce","marinara","alfredo","pesto","salsa","egg noodle","linguine","tortellini","ditalini","san marzano"],
  cereal: ["cereal","oatmeal","oats","granola","grits","cream of wheat","muesli","granola bar","protein bar"],
  condiments: ["ketchup","mustard","mayonnaise","mayo","soy sauce","worcestershire","hot sauce","sriracha","oyster sauce","fish sauce","hoisin","teriyaki","barbecue","bbq","ranch","honey","maple syrup","jam","jelly","relish","pickle","olive","capers","vinegar","balsamic","apple cider vinegar","tahini","hummus","salad dressing","marinade","lawry","tomato paste","dijon"],
  eggs: ["egg","eggs","bacon","soup","fresh pasta","quiche","chicken broth","beef broth","vegetable broth","broth","stock","bone broth","clam juice"],
  seafood: ["fish","salmon","haddock","tilapia","cod","crab","lobster","scallop","anchovy","clam","clams","mussel","oyster","swordfish","halibut","mahi","sea bass","flounder"],
  dairy: ["milk","cream","sour cream","cream cheese","parmesan","mozzarella","cheddar","ricotta","half and half","heavy cream","buttermilk","cottage cheese","whipping cream","brie","gouda","feta","string cheese","yogurt","cheese","gruyere","cotija","pecorino","butter","margarine","pie crust","pie shell"],
};

export const classifyIngredient = (ing) => {
  const lower = ing.toLowerCase();
  if (/shrimp|haddock|salmon|cod|tilapia|crab|lobster|scallop|clam|mussel|oyster|anchovy|swordfish|halibut|flounder|fish fillet/.test(lower)) return "seafood";
  // tuna → aisle 3 (condiments/canned goods area)
  if (/\btuna\b/.test(lower)) return "condiments";
  if (/broth|stock|clam juice|bone broth/.test(lower)) return "eggs";
  if (/\beggs?\b|\bbacon\b/.test(lower)) return "eggs";
  if (/tomato paste|tomato sauce/.test(lower)) return "condiments";
  if (/frozen|dumpling/.test(lower)) return "frozen1";
  // veggie/turkey burgers → aisle 18
  if (/veggie burger|vegetable burger|garden burger|black bean burger|turkey burger/.test(lower)) return "frozen2";
  if (/pie crust|pie shell/.test(lower)) return "dairy";
  // anise → spices
  if (/anise/.test(lower)) return "spices";
  // vanilla extract → spices
  if (/vanilla/.test(lower)) return "spices";
  if (/slivered almond|sliced almond/.test(lower)) return "spices";
  if (/peanut butter|almond butter|nut butter/.test(lower)) return "bread";
  if (/margarine/.test(lower)) return "dairy";
  if (/\bbutter\b/.test(lower)) return "dairy";
  if (/\bapple\b/.test(lower) && !/apple cider vinegar/.test(lower)) return "produce";
  if (/\bkiwi\b/.test(lower)) return "produce";
  if (/popcorn/.test(lower)) return "snacks";
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

export const PREP_STRIP = /,?\s*(diced|chopped|minced|sliced|crushed|peeled|grated|shredded|julienned|halved|quartered|cubed|trimmed|thawed|drained|rinsed|beaten|softened|melted|room temperature|coarsely|finely|thinly|roughly|freshly|packed|heaping|level|divided|optional|to taste|for serving|for garnish|for frying|as needed|or more|or less|hand-crushed|torn|zested and juiced|juiced|zested|deveined|pounded|cut into cubes|separated|crumbled|peeled and cubed|peeled and diced|cooked and shredded|thinly sliced|roughly chopped|finely chopped|lightly beaten|freshly grated|freshly ground)[^,]*/gi;
export const COOK_WORDS = /\b(diced|chopped|minced|sliced|crushed|peeled|grated|shredded|cubed|trimmed|beaten|softened|melted|thawed|drained|rinsed|coarsely|finely|thinly|roughly|freshly|packed|heaping|divided|optional)\b/gi;
export const SPICES_AND_PANTRY = ["salt","pepper","black pepper","white pepper","red pepper flakes","crushed red pepper","cayenne","chili powder","cumin","paprika","smoked paprika","oregano","italian seasoning","garlic powder","onion powder","cinnamon","turmeric","nutmeg","sage","thyme","rosemary","marjoram","bay leaf","coriander","allspice","cardamom","fennel","dill","curry powder","garam masala","old bay","anise","anise seed","anise seeds","star anise","baking soda","baking powder","cornstarch","yeast","vanilla extract","vanilla","cocoa powder","sugar","brown sugar","powdered sugar","kosher salt","sea salt","flour","olive oil","vegetable oil","canola oil","coconut oil","sesame oil","garlic oil","soy sauce","worcestershire","fish sauce","hot sauce","sriracha","honey","maple syrup","vinegar","balsamic","apple cider vinegar","red wine vinegar","white wine vinegar","miso paste","tomato paste","chipotle","italian herbs","breadcrumbs","panko","dijon mustard","dijon"];

export const MEAT_CONVERSIONS = [
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

export const PRODUCE_CONVERSIONS = [
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

export const toShoppingText = (raw) => {
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

export const parseAmount = (text) => {
  const m = text.match(/^([\d./\s]+)\s*(lb|lbs|oz|can|cans|cup|cups|tbsp|tsp|clove|cloves|stalk|stalks|head|heads|bunch|bunches|piece|pieces)?\s*(.+)/i);
  if (!m) return { qty: null, unit: null, name: text.trim().toLowerCase() };
  const rawQty = m[1].trim();
  let qty = rawQty.includes('/') ? rawQty.split('/').reduce((a,b)=>parseFloat(a)/parseFloat(b)) : parseFloat(rawQty);
  if (isNaN(qty)) return { qty: null, unit: null, name: text.trim().toLowerCase() };
  const unitMap = { lbs:"lb",lb:"lb",oz:"oz",can:"can",cans:"can",cup:"cup",cups:"cup",tbsp:"tbsp",tsp:"tsp",clove:"clove",cloves:"clove",stalk:"stalk",stalks:"stalk",head:"head",heads:"head",bunch:"bunch",bunches:"bunch" };
  return { qty, unit: unitMap[(m[2]||"").toLowerCase()] || (m[2]||"").toLowerCase(), name: m[3].trim().toLowerCase() };
};

export const formatQty = (qty) => {
  if (!qty) return "";
  const r = Math.round(qty*4)/4, w = Math.floor(r), f = r-w;
  const fs = f===0.25?"1/4":f===0.5?"1/2":f===0.75?"3/4":"";
  if (w===0) return fs; if (fs) return `${w} ${fs}`; return `${w}`;
};

export const PRODUCE_ORDER = [
  "onion","onions","garlic","shallot","scallion","green onion","potato","potatoes","sweet potato","ginger",
  "broccoli","cauliflower","cabbage","kale","arugula","lettuce","celery","carrot","carrots","corn","green beans","squash","zucchini","cucumber","pepper","peppers","jalapeno","poblano","tomato","tomatoes","cherry tomato","roma","fresh herb","cilantro","parsley","basil","thyme","rosemary",
  "asparagus",
  "apple","kiwi",
  "banana",
  "berries","lime","lemon","limes","lemons","orange",
  "mushroom","mushrooms",
  "spinach","avocado","avocados",
];

export const produceSubSort = (items) => {
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

export const combineItems = (items) => {
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
