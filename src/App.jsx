import { useState, useMemo, useEffect, useRef, useSyncExternalStore } from "react";
import { auth, db } from "./firebase";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch
} from "firebase/firestore";
import {
  APP_NAME,
  CATEGORIES, STORE_SECTIONS, TARGET_CATEGORIES,
  classifyTarget, LOWES_CATEGORIES, classifyLowes,
  classifyIngredient,
  toShoppingText, combineItems, parseAmount,
  produceSubSort, KEYWORD_MAP, PREP_STRIP
} from "./config.js";
import {
  ShoppingCart, Target as TargetIcon, Hammer, Wheat, Carrot, Beef, Sandwich, Snowflake, Pizza, Wine,
  Cookie, Droplet, CupSoda, Popcorn, Sparkles, PawPrint, SprayCan, Pill, Utensils, Coffee, Package,
  Soup, Milk, Salad, Egg, Fish, Shirt, Home as HomeIcon, Zap, Gamepad2, Layers, Wrench, DoorOpen,
  Paintbrush, Leaf, TreePine, Wind, X, Pencil, Check, Sun, Star, FileText, Camera, Link2,
  AlertTriangle, ChevronLeft, ChevronRight, Search, ArrowUpDown, BookOpen, Download,
  MoreVertical, RotateCcw, Plus, Minus, Menu, Store, ShoppingBag, Trash2, MapPin,
  Image as ImageIcon, Loader2, MessageCircle, Lightbulb, Archive, Mic, Repeat
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   1. Utilities and design constants
   ═══════════════════════════════════════════════════════════════════════════ */

/** Join conditional class names. Falsy entries are dropped. */
const cx = (...parts) => parts.filter(Boolean).join(" ");

/** All categories a recipe shows under: its main one first, then any extras. */
const RECIPE_CATS = ["Appetizers", "Italian", "Soups & Stews", "Mains", "Meats", "Fish & Seafood", "Vegetables", "Sides", "Desserts", "Breads & Breakfast", "Drinks", "Other"];
const catsOf = (r) => {
  const list = [r?.category, ...(Array.isArray(r?.categories) ? r.categories : [])].filter((c) => RECIPE_CATS.includes(c));
  const u = [...new Set(list)];
  return u.length ? u : ["Other"];
};

const isMobile =
  typeof navigator !== "undefined" &&
  navigator.maxTouchPoints > 0 &&
  window.matchMedia("(pointer: coarse)").matches;

/* Shared surface recipes — one place to change the whole app's card language. */
const CARD =
  "bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm transition-all duration-200";
const CARD_INTERACTIVE =
  "hover:shadow-md hover:ring-slate-300 active:scale-[0.995] cursor-pointer";
const LABEL_SM =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400";

/**
 * Colour presets for stores. Every value is a literal class string so Tailwind
 * keeps it at build time — never interpolate a colour into a class name.
 */
const COLOR_PRESETS = {
  indigo: {
    text: "text-indigo-600", solid: "bg-indigo-600", soft: "bg-indigo-50", softText: "text-indigo-700",
    bar: "from-indigo-400 via-indigo-500 to-indigo-600", check: "bg-indigo-600 border-indigo-600",
    swatch: "bg-indigo-500",
  },
  red: {
    text: "text-red-600", solid: "bg-red-600", soft: "bg-red-50", softText: "text-red-700",
    bar: "from-red-400 via-red-500 to-red-600", check: "bg-red-600 border-red-600",
    swatch: "bg-red-500",
  },
  blue: {
    text: "text-blue-600", solid: "bg-blue-600", soft: "bg-blue-50", softText: "text-blue-700",
    bar: "from-blue-400 via-blue-500 to-blue-600", check: "bg-blue-600 border-blue-600",
    swatch: "bg-blue-500",
  },
  emerald: {
    text: "text-emerald-600", solid: "bg-emerald-600", soft: "bg-emerald-50", softText: "text-emerald-700",
    bar: "from-emerald-400 via-emerald-500 to-emerald-600", check: "bg-emerald-600 border-emerald-600",
    swatch: "bg-emerald-500",
  },
  amber: {
    text: "text-amber-600", solid: "bg-amber-600", soft: "bg-amber-50", softText: "text-amber-700",
    bar: "from-amber-400 via-amber-500 to-amber-600", check: "bg-amber-600 border-amber-600",
    swatch: "bg-amber-500",
  },
  violet: {
    text: "text-violet-600", solid: "bg-violet-600", soft: "bg-violet-50", softText: "text-violet-700",
    bar: "from-violet-400 via-violet-500 to-violet-600", check: "bg-violet-600 border-violet-600",
    swatch: "bg-violet-500",
  },
  rose: {
    text: "text-rose-600", solid: "bg-rose-600", soft: "bg-rose-50", softText: "text-rose-700",
    bar: "from-rose-400 via-rose-500 to-rose-600", check: "bg-rose-600 border-rose-600",
    swatch: "bg-rose-500",
  },
  teal: {
    text: "text-teal-600", solid: "bg-teal-600", soft: "bg-teal-50", softText: "text-teal-700",
    bar: "from-teal-400 via-teal-500 to-teal-600", check: "bg-teal-600 border-teal-600",
    swatch: "bg-teal-500",
  },
};
const COLOR_KEYS = Object.keys(COLOR_PRESETS);

/** Icons a custom store can pick from. */
const STORE_ICON_CHOICES = [
  { key: "store", icon: Store },
  { key: "bag", icon: ShoppingBag },
  { key: "cart", icon: ShoppingCart },
  { key: "pill", icon: Pill },
  { key: "paw", icon: PawPrint },
  { key: "wrench", icon: Wrench },
  { key: "shirt", icon: Shirt },
  { key: "coffee", icon: Coffee },
  { key: "utensils", icon: Utensils },
  { key: "package", icon: Package },
];
const STORE_ICON_MAP = Object.fromEntries(STORE_ICON_CHOICES.map((c) => [c.key, c.icon]));

/**
 * The three stores wired to config.js. Their aisle maps, category lists and
 * keyword classifiers live there; custom stores are additive and never touch it.
 */
const BUILTIN_STORES = [
  { id: "mb", label: "Market Basket", short: "Market Basket", icon: ShoppingCart, builtIn: true, takesRecipes: true, ...COLOR_PRESETS.indigo },
  { id: "target", label: "Target", short: "Target", icon: TargetIcon, builtIn: true, ...COLOR_PRESETS.red },
  { id: "lowes", label: "Lowe's", short: "Lowe's", icon: Hammer, builtIn: true, ...COLOR_PRESETS.blue },
];

/** Project a Firestore store doc into the same shape the built-ins use. */
const toNavStore = (s) => ({
  id: s.id,
  label: s.name,
  short: s.name,
  icon: STORE_ICON_MAP[s.icon] || Store,
  iconKey: s.icon,
  colorKey: s.color,
  builtIn: false,
  sections: Array.isArray(s.sections) ? s.sections : [],
  items: Array.isArray(s.items) ? s.items : [],
  checked: Array.isArray(s.checked) ? s.checked : [],
  ...(COLOR_PRESETS[s.color] || COLOR_PRESETS.indigo),
});

/* Icon lookups (mirror the keys in config.js) */
const SECTION_ICONS = {
  entrance: Wheat, produce: Carrot, meat: Beef, deli: Sandwich, frozen1: Snowflake, frozen2: Pizza,
  beverages2: Wine, bread: Cookie, water: Droplet, soda: CupSoda, snacks: Popcorn, cleaning: Sparkles,
  pet: PawPrint, health2: SprayCan, health1: Pill, kitchen: Utensils, spices: Coffee, canned: Package,
  pasta: Soup, cereal: Milk, condiments: Salad, eggs: Egg, seafood: Fish, dairy: Milk,
};
const TARGET_ICONS = {
  grocery: ShoppingCart, health: SprayCan, cleaning: Sparkles, clothing: Shirt, home: HomeIcon,
  electronics: Zap, toys: Gamepad2, pharmacy: Pill, pet: PawPrint, other: Package,
};
const LOWES_ICONS = {
  lumber: TreePine, tools: Wrench, windows: DoorOpen, paint: Paintbrush, electrical: Zap,
  plumbing: Droplet, lawn: Leaf, flooring: Layers, hvac: Wind, other: Package,
};

/** Strips a leading emoji + space from config.js labels ("🥦 Aisle 20 — Produce"). */
const stripEmoji = (label) => label.replace(/^\S+\s/, "");

/**
 * Aisle badge text. config.js stores numeric aisles as "20" but named ones
 * already carry their prefix ("AMeat", "ADeli"), so only prefix the numbers —
 * otherwise the meat counter reads "AAMeat".
 */
const aisleLabel = (aisle) => (/^\d/.test(String(aisle)) ? "A" + aisle : String(aisle));

/** Stable key from a section label. */
const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";

/**
 * Turn the section textarea into [{key,label}], reusing the key of any existing
 * section with the same label so items keep their assignment across an edit.
 */
const parseSections = (text, existing = []) => {
  const used = new Set();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => {
      const prior = existing.find((s) => s.label.toLowerCase() === label.toLowerCase());
      let key = prior ? prior.key : slugify(label);
      while (used.has(key)) key = key + "-2";
      used.add(key);
      return { key, label };
    });
};

/* ═══════════════════════════════════════════════════════════════════════════
   2. Timer helpers
   ═══════════════════════════════════════════════════════════════════════════ */

const extractTimerSeconds = (text) => {
  const t = text.toLowerCase();
  let total = 0;
  const rm = t.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*minutes?/);
  if (rm) total += parseInt(rm[2]) * 60;
  const rh = t.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*hours?/);
  if (rh) total += parseInt(rh[2]) * 3600;
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
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return h + ":" + pad(m) + ":" + pad(sec);
  return m + ":" + pad(sec);
};

const reqNotif = async () => {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch (e) { /* ignore */ }
};

const sendNotif = (title, body) => {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch (e) { /* ignore */ }
};

/* ═══════════════════════════════════════════════════════════════════════════
   3. Recipe parsing / scaling
   ═══════════════════════════════════════════════════════════════════════════ */

const parseRecipes = (text) => {
  const blocks = text.split(/\n{2,}(?=[A-Z])/);
  return blocks.map((block, i) => {
    const lines = block.trim().split("\n").filter((l) => l.trim());
    if (!lines.length) return null;
    const title = lines[0].trim();
    let category = "Other", servings = 4, section = null;
    const ingredients = [], instructions = [];
    for (let j = 1; j < lines.length; j++) {
      const l = lines[j].trim();
      const ll = l.toLowerCase();
      if (ll.startsWith("category:")) { category = l.split(":")[1]?.trim() || "Other"; section = null; continue; }
      if (ll.startsWith("servings:") || ll.startsWith("serves:")) { servings = parseInt(l.split(":")[1]) || 4; section = null; continue; }
      if (ll.match(/^ingredients?:?\s*$/)) { section = "ing"; continue; }
      if (ll.match(/^(instructions?|directions?|method|steps?):?\s*$/)) { section = "inst"; continue; }
      if (section === "ing") { const c = l.replace(/^[-*•]\s*/, "").trim(); if (c) ingredients.push(c); }
      else if (section === "inst") { const c = l.replace(/^\d+[.)]\s*/, "").trim(); if (c) instructions.push(c); }
    }
    if (!ingredients.length && !instructions.length) return null;
    const validCat = CATEGORIES.includes(category) ? category : "Other";
    return {
      id: "seed_" + i, title, category: validCat, baseServings: servings, servings,
      ingredients, instructions, favorite: false, notes: "", storage: "",
    };
  }).filter(Boolean);
};

const scaleIngredient = (line, ratio) =>
  line.replace(/(\d+\.?\d*\/?\d*)/g, (match) => {
    if (match.includes("/")) {
      const [n, d] = match.split("/").map(Number);
      const v = (n / d) * ratio;
      return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/\.?0+$/, "");
    }
    const v = parseFloat(match) * ratio;
    if (v % 1 === 0) return v.toString();
    return v.toFixed(2).replace(/\.?0+$/, "");
  });

/* ═══════════════════════════════════════════════════════════════════════════
   4. UI primitives
   ═══════════════════════════════════════════════════════════════════════════ */

function Checkbox({ checked, onChange, tone = "bg-indigo-600 border-indigo-600", shape = "round", label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cx(
        "grid place-items-center shrink-0 h-[22px] w-[22px] border-2",
        "transition-all duration-150 ease-out active:scale-[0.82]",
        shape === "round" ? "rounded-full" : "rounded-md",
        checked ? tone : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/50"
      )}
    >
      {checked && <Check size={13} strokeWidth={3.5} className="text-white animate-pop" />}
    </button>
  );
}

function IconBtn({ icon: Icon, onClick, title, tone = "text-slate-400 hover:text-slate-700 hover:bg-slate-100", size = 15, className }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx(
        "grid place-items-center h-8 w-8 rounded-lg shrink-0",
        "transition-all duration-150 active:scale-90",
        tone, className
      )}
    >
      <Icon size={size} />
    </button>
  );
}

function ProgressRail({ pct, done, checkedCount, total, barClass, note }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-slate-200/80 overflow-hidden">
        <div
          className={cx(
            "h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out",
            done ? "from-emerald-400 via-emerald-500 to-emerald-500" : barClass
          )}
          style={{ width: pct + "%" }}
        />
      </div>
      <span
        className={cx(
          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 transition-colors duration-300",
          done ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"
        )}
      >
        {pct}%
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
        {checkedCount}/{total}{note ? " · " + note : ""}
      </span>
    </div>
  );
}

/** Sticky aisle / section header, parked under the measured header height. */
function SectionHeader({ icon: Icon, label, count, tone = "text-indigo-500" }) {
  return (
    <div className="sticky top-(--hdr-h) z-20 -mx-4 px-4">
      <div className="flex items-center gap-2 border-b border-slate-200/70 bg-slate-50/85 py-2 backdrop-blur-md">
        {Icon && <Icon size={13} className={tone} />}
        <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500">{label}</span>
        {count != null && (
          <span className="ml-auto rounded-full bg-slate-200/70 px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-500">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Slim app header. Publishes its measured height as `--hdr-h` so sticky section
 * headers park exactly beneath it, whatever the header is carrying.
 */
function AppHeader({ title, subtitle, onMenu, onBack, backLabel, right, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--hdr-h", el.offsetHeight + "px");
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-0.5 rounded-lg py-1.5 pl-1 pr-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 active:scale-95"
          >
            <ChevronLeft size={18} />
            <span className="text-[13px] font-medium">{backLabel}</span>
          </button>
        ) : onMenu ? (
          <IconBtn icon={Menu} size={19} title="Open navigation" onClick={onMenu} className="md:hidden" />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-slate-900">
            {title}
          </div>
          {subtitle && <div className="truncate text-[11px] leading-tight text-slate-400">{subtitle}</div>}
        </div>

        {right}
      </div>
      {children}
    </header>
  );
}

function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <IconBtn
        icon={MoreVertical}
        size={17}
        title="More actions"
        onClick={() => setOpen((v) => !v)}
        tone={open ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:bg-slate-100 hover:text-slate-900"}
      />
      {open && (
        <div className="absolute right-0 top-10 z-50 w-56 origin-top-right animate-rise overflow-hidden rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200">
          {items.filter(Boolean).map((it, i) => {
            const Icon = it.icon;
            return (
              <button
                key={i}
                type="button"
                onClick={() => { setOpen(false); it.onClick(); }}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-150",
                  it.danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-100"
                )}
              >
                <Icon size={15} className={it.danger ? "text-red-500" : "text-slate-400"} />
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[11px] text-slate-400">{it.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="animate-fade px-8 py-16 text-center">
      {Icon && (
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100">
          <Icon size={22} className="text-slate-300" />
        </div>
      )}
      <p className="text-[14px] font-medium text-slate-500">{title}</p>
      {hint && <p className="mt-1 text-[12.5px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      <label className={cx(LABEL_SM, "mb-1.5 block")}>
        {label}
        {hint && <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-300">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const INPUT =
  "w-full rounded-xl bg-white px-3 py-2.5 text-[15px] text-slate-900 ring-1 ring-slate-200 " +
  "transition-shadow duration-150 placeholder:text-slate-300 " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500";

const BTN_PRIMARY =
  "rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm " +
  "transition-all duration-150 hover:bg-indigo-700 hover:shadow-md active:scale-95 " +
  "disabled:opacity-40 disabled:active:scale-100";

const BTN_GHOST =
  "rounded-full bg-white px-4 py-2 text-[13px] font-medium text-slate-600 ring-1 ring-slate-200 " +
  "transition-all duration-150 hover:bg-slate-50 hover:text-slate-900 active:scale-95";

/** Bottom sheet shell shared by the aisle, section, store and import modals. */
function Sheet({ title, subtitle, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex animate-fade items-end justify-center bg-slate-900/40 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "max-h-[85vh] w-full animate-sheet overflow-auto rounded-t-3xl bg-white pb-8 pt-3 shadow-2xl",
          "md:animate-rise md:rounded-3xl md:pb-6",
          wide ? "md:max-w-xl" : "md:max-w-md"
        )}
      >
        <div className="border-b border-slate-100 px-5 pb-3 text-center">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 md:hidden" />
          <div className="text-[15px] font-semibold text-slate-900">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-[13px] text-slate-400">{subtitle}</div>}
        </div>
        <div className="px-5 pt-4">{children}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Navigation
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Left navigation. A slide-over drawer below `md`, a permanent sidebar above it.
 * Stores first, then Recipes; Import now lives inside the Recipes screen.
 */
function SideNav({ open, onClose, stores, counts, activeStoreId, onSelectStore, onAddStore, onRecipes, recipesActive, recipeCount, onAssistant, onFavorites, favCount, favActive }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const row = (activeState) =>
    cx(
      "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all duration-150 active:scale-[0.98]",
      activeState ? "bg-white shadow-sm ring-1 ring-slate-200" : "hover:bg-white/70"
    );

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 animate-fade bg-slate-900/40 backdrop-blur-[2px] md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-slate-100/80 backdrop-blur-xl",
          "transition-transform duration-300 ease-out md:translate-x-0",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600">
            <ShoppingCart size={16} className="text-white" />
          </div>
          <span className="flex-1 truncate text-[15px] font-bold tracking-[-0.01em] text-slate-900">
            {APP_NAME}
          </span>
          <IconBtn icon={X} size={16} title="Close navigation" onClick={onClose} className="md:hidden" />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
          {onAssistant && (
            <button
              type="button"
              onClick={() => { onAssistant(); onClose(); }}
              className="mb-2 mt-1 flex w-full items-center gap-3 rounded-xl bg-indigo-600 px-2.5 py-2.5 text-left text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98]"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/15"><Sparkles size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">Assistant</span>
                <span className="block truncate text-[11px] text-indigo-100">Plan meals, build lists, find recipes</span>
              </span>
            </button>
          )}
          <p className={cx(LABEL_SM, "px-2.5 pb-1.5 pt-2")}>Stores</p>

          {stores.map((store) => {
            const Icon = store.icon;
            const on = !recipesActive && activeStoreId === store.id;
            const count = counts[store.id] || 0;
            return (
              <button
                key={store.id}
                type="button"
                onClick={() => { onSelectStore(store.id); onClose(); }}
                className={row(on)}
              >
                <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-transform duration-150 group-hover:scale-105", store.soft)}>
                  <Icon size={15} className={store.text} />
                </span>
                <span className={cx("min-w-0 flex-1 truncate text-[13.5px]", on ? "font-semibold text-slate-900" : "font-medium text-slate-600")}>
                  {store.label}
                </span>
                {count > 0 && (
                  <span className={cx("shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-bold tabular-nums", on ? cx(store.soft, store.softText) : "bg-slate-200/80 text-slate-500")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => { onAddStore(); onClose(); }}
            className="group mt-0.5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/70"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 transition-colors group-hover:border-indigo-400">
              <Plus size={14} className="text-slate-400 transition-colors group-hover:text-indigo-600" />
            </span>
            <span className="text-[13.5px] font-medium text-slate-500 transition-colors group-hover:text-slate-900">
              Add store
            </span>
          </button>

          <div className="my-3 border-t border-slate-200" />

          <button type="button" onClick={() => { onRecipes(); onClose(); }} className={row(recipesActive && !favActive)}>
            <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-transform duration-150 group-hover:scale-105", recipesActive ? "bg-indigo-50" : "bg-slate-200/70")}>
              <BookOpen size={15} className={recipesActive ? "text-indigo-600" : "text-slate-500"} />
            </span>
            <span className={cx("min-w-0 flex-1 truncate text-[13.5px]", recipesActive ? "font-semibold text-slate-900" : "font-medium text-slate-600")}>
              Recipes
            </span>
            {recipeCount > 0 && (
              <span className="shrink-0 rounded-full bg-slate-200/80 px-1.5 py-px text-[10.5px] font-bold tabular-nums text-slate-500">
                {recipeCount}
              </span>
            )}
          </button>

          {onFavorites && (
            <button type="button" onClick={() => { onFavorites(); onClose(); }} className={row(favActive)}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-50 transition-transform duration-150 group-hover:scale-105">
                <Star size={15} className="fill-amber-400 text-amber-400" />
              </span>
              <span className={cx("min-w-0 flex-1 truncate text-[13.5px]", favActive ? "font-semibold text-slate-900" : "font-medium text-slate-600")}>
                Favorites
              </span>
              {favCount > 0 && (
                <span className="shrink-0 rounded-full bg-slate-200/80 px-1.5 py-px text-[10.5px] font-bold tabular-nums text-slate-500">
                  {favCount}
                </span>
              )}
            </button>
          )}
        </nav>
      </aside>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Shopping-list components
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Timers: one shared store so several can run at once, across recipes ── */

/** Timers are stored by end time, so they stay correct if the phone sleeps or the page reloads. */
const timerStore = (() => {
  const KEY = "dl.timers.v1";
  let timers = {};
  try { timers = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { timers = {}; }
  const subs = new Set();
  let tick = null;
  let snapshot = timers;

  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch { /* private mode */ } };
  const emit = () => { snapshot = { ...timers }; subs.forEach((f) => f()); };

  const beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      [0, 0.35, 0.7].forEach((t) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
      });
    } catch { /* no audio */ }
    try { navigator.vibrate?.([300, 150, 300]); } catch { /* no vibrate */ }
  };

  const check = () => {
    const now = Date.now();
    let changed = false;
    Object.values(timers).forEach((t) => {
      if (t.endsAt && t.endsAt <= now && !t.done) {
        t.done = true; t.endsAt = null; t.remaining = 0; changed = true;
        beep();
        sendNotif("⏰ " + t.label, t.step?.slice(0, 80) || "Timer done");
      }
    });
    if (changed) persist();
    emit();
    if (!Object.values(timers).some((t) => t.endsAt)) { clearInterval(tick); tick = null; }
  };
  const ensureTick = () => { if (!tick) tick = setInterval(check, 500); };
  if (Object.values(timers).some((t) => t.endsAt)) ensureTick();

  const api = {
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    get: () => snapshot,
    remainingOf: (t) => (t ? (t.endsAt ? Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)) : t.remaining) : 0),
    start(id, { total, label, step, recipeId }) {
      reqNotif();
      const t = timers[id];
      const left = t && !t.done && t.remaining > 0 ? t.remaining : total;
      timers[id] = { id, total, label, step, recipeId, remaining: left, endsAt: Date.now() + left * 1000, done: false };
      persist(); ensureTick(); emit();
    },
    pause(id) {
      const t = timers[id]; if (!t?.endsAt) return;
      t.remaining = api.remainingOf(t); t.endsAt = null; persist(); emit();
    },
    addMinute(id) {
      const t = timers[id]; if (!t) return;
      if (t.done) { t.done = false; t.remaining = 60; t.endsAt = Date.now() + 60000; t.total = Math.max(t.total, 60); ensureTick(); }
      else if (t.endsAt) t.endsAt += 60000; else t.remaining += 60;
      t.total += 60; persist(); emit();
    },
    clear(id) { delete timers[id]; persist(); emit(); },
  };
  return api;
})();

const useTimers = () => useSyncExternalStore(timerStore.subscribe, timerStore.get);

/** Small ring + time shown under a recipe step. Tap to start / pause / reset. */
function StepTimer({ id, seconds, label, stepText, recipeId }) {
  const timers = useTimers();
  const t = timers[id];
  const running = !!t?.endsAt;
  const done = !!t?.done;
  const remaining = t ? timerStore.remainingOf(t) : seconds;
  const total = t?.total || seconds;
  const pct = Math.round(((total - remaining) / total) * 100);
  const circ = 2 * Math.PI * 9;

  const toggle = (e) => {
    e.stopPropagation();
    if (done) timerStore.clear(id);
    else if (running) timerStore.pause(id);
    else timerStore.start(id, { total: seconds, label, step: stepText, recipeId });
  };
  const reset = (e) => { e.stopPropagation(); timerStore.clear(id); };

  return (
    <button
      type="button"
      onClick={toggle}
      className={cx(
        "mt-2 inline-flex items-center gap-2 rounded-full py-1 pl-1.5 pr-3 ring-1 transition-all duration-200 active:scale-95",
        done ? "bg-emerald-50 text-emerald-600 ring-emerald-200"
          : running ? "bg-indigo-50 text-indigo-600 ring-indigo-200"
            : t ? "bg-amber-50 text-amber-700 ring-amber-200"
              : "bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200"
      )}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0">
        <circle cx="11" cy="11" r="9" fill="none" strokeWidth="2.5" className="stroke-slate-300/70" />
        {!done && (
          <circle
            cx="11" cy="11" r="9" fill="none" strokeWidth="2.5" strokeLinecap="round"
            className={running ? "stroke-indigo-500" : t ? "stroke-amber-500" : "stroke-slate-400"}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct / 100)}
            transform="rotate(-90 11 11)"
            style={{ transition: "stroke-dashoffset 0.5s linear" }}
          />
        )}
        <text x="11" y="15" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor">
          {done ? "✓" : running ? "▐▐" : "▶"}
        </text>
      </svg>
      <span className="min-w-[38px] text-center text-[13px] font-semibold tabular-nums">
        {done ? "Done!" : fmtTime(remaining)}
      </span>
      {t && <RotateCcw size={11} className="opacity-60" onClick={reset} />}
    </button>
  );
}

/** Bar pinned to the bottom of every screen listing all timers that are going. */
function TimerTray() {
  const timers = useTimers();
  const list = Object.values(timers).sort((a, b) =>
    (b.done - a.done) || (timerStore.remainingOf(a) - timerStore.remainingOf(b)));
  // Keep page content clear of the tray.
  useEffect(() => {
    document.body.style.paddingBottom = list.length ? list.length * 52 + 28 + "px" : "";
  }, [list.length]);
  const onOpenRecipe = (id) => id && window.dispatchEvent(new CustomEvent("dl:open-recipe", { detail: id }));
  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[900] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pl-[17rem]">
      <div className="pointer-events-auto mx-auto flex max-w-2xl flex-col gap-1.5 rounded-2xl bg-slate-900/95 p-2 shadow-2xl ring-1 ring-white/10 backdrop-blur">
        {list.map((t) => {
          const left = timerStore.remainingOf(t);
          const running = !!t.endsAt;
          return (
            <div
              key={t.id}
              className={cx(
                "flex items-center gap-2 rounded-xl px-2.5 py-1.5",
                t.done ? "animate-pulse bg-emerald-500/20" : "bg-white/5"
              )}
            >
              <button
                type="button"
                onClick={() => onOpenRecipe?.(t.recipeId)}
                className="min-w-0 flex-1 text-left"
                title="Open recipe"
              >
                <div className="truncate text-[12.5px] font-semibold text-white">{t.label}</div>
                <div className="truncate text-[11px] text-slate-400">{t.step}</div>
              </button>
              <span className={cx("w-14 text-right text-[16px] font-bold tabular-nums",
                t.done ? "text-emerald-300" : running ? "text-white" : "text-amber-300")}>
                {t.done ? "Done" : fmtTime(left)}
              </span>
              {!t.done && (
                <button type="button" onClick={() => (running ? timerStore.pause(t.id) : timerStore.start(t.id, t))}
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-white hover:bg-white/20"
                  title={running ? "Pause" : "Resume"}>
                  {running ? "▐▐" : "▶"}
                </button>
              )}
              <button type="button" onClick={() => timerStore.addMinute(t.id)}
                className="h-8 rounded-full bg-white/10 px-2 text-[11px] font-semibold text-white hover:bg-white/20" title="Add a minute">
                +1m
              </button>
              <button type="button" onClick={() => timerStore.clear(t.id)}
                className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white" title="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MBItem({
  item, sec, isEd, editingText, setEditingText, editingQty, setEditingQty,
  onToggle, onEdit, onSaveEdit, onCancelEdit, onRemove, onAislePick, onPantry,
  recipes, setSelectedId, setView,
}) {
  const rnames = item.recipeList || [item.recipe];

  return (
    <div className={cx(CARD, "group mb-1.5 flex items-start gap-3 px-3.5 py-3 hover:shadow-md hover:ring-slate-300")}>
      <div className="pt-0.5">
        <Checkbox checked={false} onChange={() => onToggle(item.key)} label={"Check off " + item.text} />
      </div>

      <div className="min-w-0 flex-1">
        {isEd ? (
          <div
            className="flex items-center gap-2"
            onBlur={(e) => {
              // Save when focus leaves the whole edit row (tapping elsewhere),
              // not when moving between the qty and name boxes or onto OK/Cancel.
              if (!e.currentTarget.contains(e.relatedTarget)) onSaveEdit(item.key);
            }}
          >
            <input
              type="number" inputMode="numeric" min={1} max={99} autoFocus placeholder="Qty"
              value={editingQty}
              onChange={(e) => setEditingQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(item.key); if (e.key === "Escape") onCancelEdit(); }}
              className="w-14 rounded-lg px-2 py-1.5 text-center text-[14px] tabular-nums ring-2 ring-indigo-500 focus:outline-none"
            />
            <input
              value={editingText}
              enterKeyHint="done"
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(item.key); if (e.key === "Escape") onCancelEdit(); }}
              placeholder="item name"
              className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[14px] ring-2 ring-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              title="Save"
              aria-label="Save"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSaveEdit(item.key)}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-all duration-150 hover:bg-indigo-700 active:scale-95"
            >
              OK
            </button>
            <button
              type="button"
              title="Cancel"
              aria-label="Cancel"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onCancelEdit}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onToggle(item.key)}
              className="block w-full text-left text-[14.5px] leading-snug text-slate-800 transition-colors hover:text-slate-950"
            >
              {item.text}
            </button>
            {rnames.filter(Boolean).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5">
                {rnames.map((name, idx) => {
                  const r = recipes.find((x) => x.title === String(name).trim());
                  return r ? (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => { setSelectedId(r.id); setView("recipes"); }}
                      className="text-[11.5px] italic text-indigo-500 underline decoration-indigo-200 underline-offset-2 transition-colors hover:text-indigo-700 hover:decoration-indigo-400"
                    >
                      {name}
                    </button>
                  ) : (
                    <span key={idx} className="text-[11.5px] italic text-slate-400">{name}</span>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {!isEd && <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <IconBtn icon={Pencil} size={13} title="Edit item" onClick={(e) => onEdit(item.key, item.text, e)} />
        {onPantry && <IconBtn icon={Archive} size={13} title="Always have this — add to pantry staples" onClick={() => onPantry(item)} tone="text-slate-400 hover:bg-amber-50 hover:text-amber-600" />}
        <IconBtn icon={X} size={14} title="Remove item" onClick={() => onRemove(item.key)} tone="text-slate-400 hover:bg-red-50 hover:text-red-600" />
      </div>}

      <button
        type="button"
        onClick={() => onAislePick(item)}
        title="Change aisle"
        className="mt-0.5 shrink-0 select-none rounded-full bg-indigo-50 px-2.5 py-1 text-[10.5px] font-bold tabular-nums text-indigo-600 ring-1 ring-indigo-100 transition-all duration-150 hover:bg-indigo-100 hover:ring-indigo-300 active:scale-90"
      >
        {aisleLabel(sec.aisle)}
      </button>
    </div>
  );
}

function CompletedItem({ item, sec, onToggle, onRemove, onSaveQty }) {
  const parsed = String(item.text).match(/^(\d+)\s+(.+)$/);
  const [qty, setQty] = useState(parsed ? parsed[1] : "");

  useEffect(() => {
    const p = String(item.text).match(/^(\d+)\s+(.+)$/);
    setQty(p ? p[1] : "");
  }, [item.text]);

  const commit = () => { if (item.manual) onSaveQty(item.key, qty); };
  const rnames = (item.recipeList || [item.recipe]).filter(Boolean);

  return (
    <div className={cx(CARD, "group mb-1.5 flex items-start gap-3 px-3.5 py-3 opacity-60 hover:opacity-100")}>
      <div className="pt-0.5">
        <Checkbox checked onChange={() => onToggle(item.key)} label={"Uncheck " + item.text} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] leading-snug text-slate-400 line-through decoration-slate-300 decoration-[1.5px]">
          {item.text}
        </div>
        {rnames.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-1.5">
            {rnames.map((name, idx) => (
              <span key={idx} className="text-[11.5px] italic text-slate-300">{name}</span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <input
          type="number" min={1} max={99} placeholder="Qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } }}
          disabled={!item.manual}
          title={item.manual ? "Adjust quantity" : "Quantity comes from the recipe"}
          className="w-11 rounded-lg bg-slate-50 px-1.5 py-1 text-center text-[12px] tabular-nums text-slate-500 ring-1 ring-slate-200 transition-shadow placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <IconBtn icon={X} size={14} title="Remove item" onClick={() => onRemove(item.key)} tone="text-slate-300 hover:bg-red-50 hover:text-red-600" />
      </div>

      {sec && (
        <span className="mt-0.5 shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-bold tabular-nums text-slate-400">
          {aisleLabel(sec.aisle)}
        </span>
      )}
    </div>
  );
}

/** Target / Lowe's row — classifier-driven, no section badge. */
function GenericItem({ item, done, onToggle, onRemove, store }) {
  return (
    <div className={cx(CARD, "group mb-1.5 flex items-center gap-3 px-3.5 py-3 hover:shadow-md hover:ring-slate-300", done && "opacity-55")}>
      <Checkbox checked={done} onChange={() => onToggle(item.key)} tone={store.check} label={"Toggle " + item.text} />
      <button
        type="button"
        onClick={() => onToggle(item.key)}
        className={cx(
          "min-w-0 flex-1 truncate text-left text-[14.5px] transition-colors duration-200",
          done ? "text-slate-400 line-through decoration-slate-300 decoration-[1.5px]" : "text-slate-800 hover:text-slate-950"
        )}
      >
        {item.text}
      </button>
      <div className="shrink-0 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
        <IconBtn icon={X} size={14} title="Remove item" onClick={() => onRemove(item.key)} tone="text-slate-400 hover:bg-red-50 hover:text-red-600" />
      </div>
    </div>
  );
}

/** Custom-store row — carries a clickable section badge, like the aisle badge. */
function CustomItem({ item, done, sectionLabel, onToggle, onRemove, onPickSection, store }) {
  return (
    <div className={cx(CARD, "group mb-1.5 flex items-center gap-3 px-3.5 py-3 hover:shadow-md hover:ring-slate-300", done && "opacity-55")}>
      <Checkbox checked={done} onChange={() => onToggle(item.key)} tone={store.check} label={"Toggle " + item.text} />
      <button
        type="button"
        onClick={() => onToggle(item.key)}
        className={cx(
          "min-w-0 flex-1 truncate text-left text-[14.5px] transition-colors duration-200",
          done ? "text-slate-400 line-through decoration-slate-300 decoration-[1.5px]" : "text-slate-800 hover:text-slate-950"
        )}
      >
        {item.text}
      </button>
      <div className="shrink-0 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
        <IconBtn icon={X} size={14} title="Remove item" onClick={() => onRemove(item.key)} tone="text-slate-400 hover:bg-red-50 hover:text-red-600" />
      </div>
      <button
        type="button"
        onClick={() => onPickSection(item)}
        title="Change section"
        className={cx(
          "max-w-[7.5rem] shrink-0 select-none truncate rounded-full px-2.5 py-1 text-[10.5px] font-bold transition-all duration-150 active:scale-90",
          sectionLabel
            ? cx(store.soft, store.softText, "hover:brightness-95")
            : "bg-slate-100 text-slate-400 hover:bg-slate-200"
        )}
      >
        {sectionLabel || "Unsorted"}
      </button>
    </div>
  );
}

/** Floating "add item" bar. Enter commits and keeps focus for rapid entry. */
/** Speech-to-text via the browser (Chrome, Edge, Safari). Returns null where unsupported. */
const SpeechRec = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

/** Does this look like more than one plain item (so the AI should read it)? */
const needsSmartAdd = (text, storeNames) => {
  const t = text.toLowerCase();
  if (/[,;]|\band\b|\bplus\b|\balso\b/.test(t)) return true;
  if (storeNames.some((n) => n && t.includes(n.toLowerCase()))) return true;
  if (/\b(from|at|for)\b/.test(t) && t.split(/\s+/).length > 3) return true;
  return t.split(/\s+/).length > 6;
};

function AddItemBar({ qty, setQty, value, setValue, onAdd, onSmartAdd, smartBusy, toast, store, storeNames = [] }) {
  const inputRef = useRef(null);
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const heardRef = useRef("");

  const commit = () => {
    const v = value.trim();
    if (!v || smartBusy) return;
    if (onSmartAdd && needsSmartAdd(v, storeNames)) onSmartAdd(v);
    else onAdd();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const toggleMic = () => {
    if (!SpeechRec) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SpeechRec();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    heardRef.current = "";
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      heardRef.current = text;
      setValue(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      const heard = heardRef.current.trim();
      if (heard && onSmartAdd) onSmartAdd(heard);
    };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  return (
    <div className="fixed inset-x-0 float-bottom z-30 px-3 md:pl-[17rem] md:pr-4">
      {toast && (
        <div className="mx-auto mb-2 max-w-lg animate-rise rounded-2xl bg-slate-900/95 px-3.5 py-2.5 text-[12.5px] leading-snug text-white shadow-lg">
          {toast}
        </div>
      )}
      <div className={cx(
        "mx-auto flex max-w-lg items-center rounded-full bg-white/95 p-1 shadow-lg ring-1 backdrop-blur-xl transition-shadow duration-200 focus-within:shadow-xl focus-within:ring-2 focus-within:ring-indigo-500",
        listening ? "ring-2 ring-red-400" : "ring-slate-200"
      )}>
        <input
          type="number" min={1} max={99}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); inputRef.current?.focus(); } }}
          placeholder="1"
          aria-label="Quantity"
          className="w-11 shrink-0 bg-transparent py-2 text-center text-[15px] tabular-nums text-slate-700 placeholder:text-slate-300 focus:outline-none"
        />
        <span className="h-5 w-px shrink-0 bg-slate-200" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          placeholder={listening ? "Listening…" : smartBusy ? "Sorting it out…" : "Add to " + store.short + "… or say a few"}
          aria-label="Item name"
          disabled={smartBusy}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
        />
        {SpeechRec && onSmartAdd && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleMic}
            disabled={smartBusy}
            title={listening ? "Stop" : "Say what to add"}
            className={cx(
              "mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors",
              listening ? "animate-pulse bg-red-500 text-white" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            <Mic size={17} />
          </button>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          disabled={!value.trim() || smartBusy}
          className={cx(
            "flex shrink-0 items-center gap-1 rounded-full px-3.5 py-2 text-[13px] font-semibold text-white",
            "transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100",
            store.solid
          )}
        >
          {smartBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} strokeWidth={2.75} />}
          Add
        </button>
      </div>
    </div>
  );
}

/* ── Usuals: learned from what you add ── */

/** A name too vague to base an aisle rule on: a bare unit ("cup"), or under 3 letters. */
const UNIT_WORDS = new Set(["cup","cups","c","tbsp","tbs","tablespoon","tablespoons","tsp","teaspoon","teaspoons","oz","ounce","ounces","lb","lbs","pound","pounds","g","gram","grams","kg","ml","l","liter","quart","quarts","pint","pints","gallon","can","cans","jar","jars","bag","bags","box","boxes","package","packages","pkg","clove","cloves","pinch","dash","piece","pieces","stick","sticks","slice","slices","bunch","bunches","head","heads","stalk","stalks","handful","large","medium","small","whole","item","items"]);
const isVagueName = (name) => {
  const n = String(name || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return n.length < 3 || n.split(" ").every((w) => UNIT_WORDS.has(w));
};

const DAY = 86400000;
const usualName = (text) => String(text).toLowerCase().replace(/^[\d./\s]+(x\s+)?/, "").replace(/\s+/g, " ").trim();

/** Turn the stored history for one store into a sorted list with "due" flags. */
const usualsFor = (hist, onList) => {
  const now = Date.now();
  return Object.entries(hist || {})
    .filter(([name, u]) => u && !u.hidden && (u.n || 0) >= 2 && !onList.has(name))
    .map(([name, u]) => {
      const t = (u.t || []).slice().sort((a, b) => a - b);
      const last = t[t.length - 1] || 0;
      const every = t.length >= 2 ? (t[t.length - 1] - t[0]) / (t.length - 1) : null;
      const since = now - last;
      const due = every ? since >= every * 0.85 : since >= 7 * DAY;
      return { name, label: u.label || name, qty: u.q || 1, section: u.s || "", n: u.n, every, since, due };
    })
    .sort((a, b) => (b.due - a.due) || (b.n - a.n));
};

const fmtDays = (ms) => {
  const d = Math.round(ms / DAY);
  return d <= 0 ? "today" : d === 1 ? "1 day" : d + " days";
};

function UsualsSheet({ storeName, usuals, onAdd, onForget, onClose }) {
  const [picked, setPicked] = useState(() => new Set(usuals.filter((u) => u.due).map((u) => u.name)));
  const toggle = (n) => setPicked((p) => { const x = new Set(p); x.has(n) ? x.delete(n) : x.add(n); return x; });

  return (
    <Sheet title="Your usuals" subtitle={storeName + " · learned from what you add"} onClose={onClose} wide>
      {usuals.length === 0 ? (
        <EmptyState icon={Repeat} title="Nothing learned yet" hint="Items you add more than once show up here, with a nudge when they're due." />
      ) : (
        <div className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
          {usuals.map((u) => (
            <div key={u.name} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
              <Checkbox checked={picked.has(u.name)} onChange={() => toggle(u.name)} shape="square" label={u.label} />
              <button type="button" onClick={() => toggle(u.name)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-slate-800">{u.qty > 1 ? u.qty + " " : ""}{u.label}</span>
                  {u.due && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">DUE</span>}
                </div>
                <div className="text-[11.5px] text-slate-400">
                  {u.every ? "about every " + fmtDays(u.every) + " · " : ""}last added {fmtDays(u.since)} ago · {u.n}×
                </div>
              </button>
              <IconBtn icon={X} size={13} title={"Stop suggesting " + u.label} onClick={() => onForget(u.name)} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN_GHOST}>Close</button>
        <button
          type="button"
          disabled={!picked.size}
          onClick={() => { onAdd(usuals.filter((u) => picked.has(u.name))); onClose(); }}
          className={BTN_PRIMARY}
        >
          Add {picked.size || ""} to list
        </button>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. Modals
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Per-item aisle reassignment — tap an item's badge while shopping to move it.
 * Saves a permanent keyword→aisle rule (keyed on the item's own text) that
 * applies to every future occurrence of that item too.
 */
function AisleEditorModal({ item, onSelect, onManage, onClose }) {
  const [aisleInput, setAisleInput] = useState("");
  const [error, setError] = useState(null);

  const handleSave = () => {
    const normalized = aisleInput.trim().toUpperCase().replace(/^A/, "");
    if (!normalized) { setError("Aisle cannot be empty"); return; }
    const section = STORE_SECTIONS.find((s) => s.aisle === normalized || s.aisle === "A" + normalized);
    if (!section) {
      setError('No aisle "' + aisleInput + '" found. Try one of: 1-20, AMeat, ADeli, ASeafood, Entrance');
      return;
    }
    onSelect(section.key);
  };

  return (
    <Sheet title="Change aisle" subtitle={item.text} onClose={onClose}>
      <input
        autoFocus
        type="text"
        value={aisleInput}
        onChange={(e) => { setAisleInput(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
        placeholder="e.g. 20 or AMeat"
        className={cx(
          "w-full rounded-xl px-3.5 py-3 text-[16px] text-slate-900 ring-1 transition-shadow placeholder:text-slate-300 focus:outline-none focus:ring-2",
          error ? "ring-red-400 focus:ring-red-500" : "ring-slate-200 focus:ring-indigo-500"
        )}
      />
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-red-600">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onManage}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <MapPin size={13} /> View saved aisle settings
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
        <button type="button" onClick={handleSave} className={BTN_PRIMARY}>Save</button>
      </div>
    </Sheet>
  );
}

/**
 * Review screen for saved aisle settings — every keyword→aisle assignment
 * you've made by tapping an item's badge. Delete one if you got it wrong;
 * there is deliberately no "clear all" here, so a stray tap can't wipe out
 * everything you've set.
 */
function AisleRulesModal({ rules, onDelete, onClose }) {
  const entries = Object.entries(rules);

  return (
    <Sheet title="Saved aisle settings" subtitle={entries.length + " item" + (entries.length !== 1 ? "s" : "") + " reassigned"} onClose={onClose} wide>
      {entries.length === 0 ? (
        <EmptyState icon={MapPin} title="No aisle settings yet" hint="Tap an item's aisle badge on the shopping list to set one." />
      ) : (
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {entries.map(([kw, sectionKey]) => {
            const sec = STORE_SECTIONS.find((s) => s.key === sectionKey);
            return (
              <div key={kw} className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-slate-700">{kw}</span>
                <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-bold tabular-nums text-indigo-600">
                  {sec ? aisleLabel(sec.aisle) : sectionKey}
                </span>
                <IconBtn icon={Trash2} size={13} title={'Remove aisle setting for "' + kw + '"'} onClick={() => onDelete(kw)} tone="text-slate-400 hover:bg-red-50 hover:text-red-600" />
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className={BTN_GHOST}>Done</button>
      </div>
    </Sheet>
  );
}

/* ── Pantry staples: things always on hand, kept off the Market Basket list ── */

const PANTRY_SUGGESTIONS = [
  "salt", "black pepper", "olive oil", "vegetable oil", "butter", "garlic powder", "onion powder",
  "paprika", "chili powder", "cumin", "dried oregano", "dried thyme", "red pepper flakes",
  "flour", "sugar", "brown sugar", "baking soda", "baking powder", "vanilla extract",
  "soy sauce", "worcestershire sauce", "white vinegar", "cooking spray",
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True if a shopping-list line is covered by one of the pantry staples (whole-word match). */
const isPantryStaple = (text, pantry) => {
  if (!pantry?.length) return false;
  // The item's name is what's left after dropping "(...)", anything after a comma, and "to taste".
  // A staple must be how the name ENDS: "kosher salt" matches "salt"; "salt pork" doesn't.
  const t = String(text).toLowerCase().replace(/\([^)]*\)/g, " ").split(",")[0]
    .replace(/\b(to taste|as needed|for serving|optional)\b/g, " ").replace(/\s+/g, " ").trim();
  return pantry.some((p) => {
    const k = p.toLowerCase().trim();
    if (!k) return false;
    if (t === "pepper" && (k === "black pepper" || k === "pepper")) return true;
    return new RegExp("(^|[^a-z])" + escapeRe(k) + "(s|es)?$").test(t);
  });
};

function PantryModal({ pantry, onSave, onClose }) {
  const [input, setInput] = useState("");
  const list = [...pantry].sort((a, b) => a.localeCompare(b));
  const add = (v) => {
    const k = v.trim().toLowerCase();
    if (!k || pantry.includes(k)) { setInput(""); return; }
    onSave([...pantry, k]); setInput("");
  };
  const remove = (k) => onSave(pantry.filter((p) => p !== k));
  const ideas = PANTRY_SUGGESTIONS.filter((s) => !pantry.includes(s));

  return (
    <Sheet title="Pantry staples" subtitle="Always on hand — left off the list when you pick recipes" onClose={onClose} wide>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add(input)}
          placeholder="e.g. olive oil"
          className={INPUT}
        />
        <button type="button" onClick={() => add(input)} disabled={!input.trim()} className={cx(BTN_PRIMARY, "shrink-0")}>Add</button>
      </div>
      <p className="mt-2 text-[12px] text-slate-400">
        Be specific: "black pepper" won't catch bell peppers, but "pepper" would.
      </p>

      <div className="mt-4">
        <div className={cx(LABEL_SM, "mb-2")}>Your staples ({list.length})</div>
        {list.length === 0 ? (
          <p className="text-[13px] text-slate-400">None yet. Tap some ideas below or type your own.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {list.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-[13px] text-indigo-800 ring-1 ring-indigo-100">
                {k}
                <button type="button" onClick={() => remove(k)} className="grid h-5 w-5 place-items-center rounded-full hover:bg-indigo-100" aria-label={"Remove " + k}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {ideas.length > 0 && (
        <div className="mt-5">
          <div className={cx(LABEL_SM, "mb-2")}>Ideas</div>
          <div className="flex flex-wrap gap-1.5">
            {ideas.map((k) => (
              <button key={k} type="button" onClick={() => add(k)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[13px] text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                <Plus size={12} /> {k}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className={BTN_GHOST}>Done</button>
      </div>
    </Sheet>
  );
}

/** Pick which of a custom store's sections an item belongs to. */
function SectionPickerModal({ item, store, onSelect, onManage, onClose }) {
  return (
    <Sheet title="Move to section" subtitle={item.text} onClose={onClose}>
      <div className="flex flex-col gap-1">
        {store.sections.map((s) => {
          const on = item.sectionKey === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s.key)}
              className={cx(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors",
                on ? cx(store.soft, store.softText, "font-semibold") : "text-slate-700 hover:bg-slate-100"
              )}
            >
              <span className="flex-1 truncate">{s.label}</span>
              {on && <Check size={15} strokeWidth={3} />}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cx(
            "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors",
            !item.sectionKey ? "bg-slate-100 font-semibold text-slate-700" : "text-slate-500 hover:bg-slate-100"
          )}
        >
          <span className="flex-1">Unsorted</span>
          {!item.sectionKey && <Check size={15} strokeWidth={3} />}
        </button>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onManage}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
        >
          <Pencil size={14} />
          Manage sections for {store.label}
        </button>
      </div>
    </Sheet>
  );
}

/** Create or edit a custom store: name, colour, icon, sections. */
function StoreEditorModal({ store, onSave, onDelete, onClose }) {
  const editing = !!store;
  const [name, setName] = useState(store?.label || "");
  const [color, setColor] = useState(store?.colorKey || "emerald");
  const [iconKey, setIconKey] = useState(store?.iconKey || "store");
  const [sectionsText, setSectionsText] = useState((store?.sections || []).map((s) => s.label).join("\n"));
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState(null);

  const save = () => {
    if (!name.trim()) { setError("Give the store a name"); return; }
    onSave({
      name: name.trim(),
      color,
      icon: iconKey,
      sections: parseSections(sectionsText, store?.sections || []),
    });
  };

  return (
    <Sheet
      title={editing ? "Edit store" : "New store"}
      subtitle={editing ? store.label : "Add a store and its sections"}
      onClose={onClose}
      wide
    >
      <Field label="Name">
        <input
          autoFocus={!editing}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="e.g. Hannaford, Tractor Supply, CVS"
          className={cx(INPUT, error && "ring-red-400 focus:ring-red-500")}
        />
        {error && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-red-600">
            <AlertTriangle size={13} /> {error}
          </p>
        )}
      </Field>

      <Field label="Colour">
        <div className="flex flex-wrap gap-2">
          {COLOR_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setColor(k)}
              title={k}
              className={cx(
                "h-8 w-8 rounded-full transition-all duration-150 active:scale-90",
                COLOR_PRESETS[k].swatch,
                color === k ? "ring-2 ring-slate-900 ring-offset-2" : "hover:scale-110"
              )}
            />
          ))}
        </div>
      </Field>

      <Field label="Icon">
        <div className="flex flex-wrap gap-2">
          {STORE_ICON_CHOICES.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setIconKey(key)}
              title={key}
              className={cx(
                "grid h-9 w-9 place-items-center rounded-xl transition-all duration-150 active:scale-90",
                iconKey === key
                  ? cx(COLOR_PRESETS[color].soft, "ring-2", "ring-slate-900")
                  : "bg-slate-100 hover:bg-slate-200"
              )}
            >
              <Icon size={16} className={iconKey === key ? COLOR_PRESETS[color].text : "text-slate-500"} />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Sections" hint="(one per line, in the order you walk the store)">
        <textarea
          value={sectionsText}
          onChange={(e) => setSectionsText(e.target.value)}
          placeholder={"Produce\nDairy\nPharmacy\nCheckout"}
          className={cx(INPUT, "h-32 resize-y leading-relaxed")}
        />
        <p className="mt-1.5 text-[11.5px] text-slate-400">
          Leave this empty for a plain flat list. Items you don't assign show under "Unsorted".
        </p>
      </Field>

      <div className="mt-5 flex items-center gap-2">
        {editing && (
          confirmDel ? (
            <>
              <button
                type="button"
                onClick={onDelete}
                className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-red-700 active:scale-95"
              >
                Delete for good
              </button>
              <button type="button" onClick={() => setConfirmDel(false)} className={BTN_GHOST}>Keep</button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          )
        )}
        <div className="flex-1" />
        <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
        <button type="button" onClick={save} className={BTN_PRIMARY}>
          {editing ? "Save" : "Create store"}
        </button>
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7b. Recipe import — one box for anything, then review before saving
   ═══════════════════════════════════════════════════════════════════════════ */

/** Shrink a photo to a sensible size and return { base64, mediaType, preview }. */
const prepareImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      URL.revokeObjectURL(url);
      resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });

/** Recipe object ⇄ editable draft (lists become one-per-line text). */
const toDraft = (r) => ({
  title: r.title || "", cats: catsOf({ category: r.category, categories: r.categories }), servings: r.servings || 4,
  ingredients: (r.ingredients || []).join("\n"), instructions: (r.instructions || []).join("\n"),
  notes: r.notes || "", storage: r.storage || "",
});
const fromDraft = (d) => {
  const servings = Math.max(1, parseInt(d.servings) || 4);
  return {
    title: d.title.trim() || "Untitled Recipe",
    category: catsOf({ categories: d.cats })[0],
    categories: catsOf({ categories: d.cats }),
    extra_categories: catsOf({ categories: d.cats }).slice(1), // lets the AI keep extras when editing
    servings, baseServings: servings,
    ingredients: d.ingredients.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean),
    instructions: d.instructions.split("\n").map((l) => l.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean),
    notes: d.notes.trim(), storage: d.storage.trim(),
  };
};

const postImport = async (payload) => {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(data.error || "Import failed (" + res.status + ")");
  return data.recipes || [];
};

function ImportSheet({ onClose, onSave }) {
  const [stage, setStage] = useState("input");      // input | working | review
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);         // [{ base64, mediaType, preview }]
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);

  const isLink = /^https?:\/\/\S+$/i.test(text.trim());
  const canGo = text.trim() || images.length;

  const addFiles = async (files) => {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setError(null);
    try {
      const prepared = await Promise.all(list.map(prepareImage));
      setImages((cur) => [...cur, ...prepared].slice(0, 8));
    } catch (e) { setError(e.message); }
  };

  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addFiles(files); }
  };

  const run = async () => {
    if (!canGo) return;
    setStage("working"); setError(null);
    try {
      const recipes = await postImport({ text: text.trim(), images: images.map(({ base64, mediaType }) => ({ base64, mediaType })) });
      if (!recipes.length) throw new Error("No recipe found in that.");
      setDrafts(recipes.map(toDraft));
      setStage("review");
    } catch (e) {
      // Offline / service down: if the pasted text is already in the classic format, use it as-is.
      const local = !images.length && !isLink ? parseRecipes(text) : [];
      if (local.length) { setDrafts(local.map(toDraft)); setStage("review"); return; }
      setError(e.message || "Something went wrong.");
      setStage("input");
    }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try { await onSave(drafts.map(fromDraft)); }
    catch (e) { setError(e.message || "Couldn't save."); setSaving(false); }
  };

  const busy = stage === "working";
  const title = stage === "review" ? (drafts.length > 1 ? "Review " + drafts.length + " recipes" : "Review recipe") : "Add a recipe";
  const subtitle = stage === "review" ? "Check it over, ask for changes, then save" : "Paste anything, drop a link, or snap a photo";

  return (
    <Sheet title={title} subtitle={subtitle} onClose={busy || saving ? () => {} : onClose} wide>
      {stage !== "review" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          className={cx("rounded-2xl transition-shadow", dragOver && "ring-2 ring-indigo-400")}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            disabled={busy}
            autoFocus={!isMobile}
            placeholder={"Paste a recipe in any format — from a website, an email, a text, your notes…\n\nOr paste a link to a recipe page."}
            className="h-44 w-full resize-y rounded-2xl bg-slate-50 p-3.5 text-[14px] leading-relaxed text-slate-900 ring-1 ring-slate-200 transition-shadow placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          />

          {images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img.preview} alt={"Photo " + (i + 1)} className="h-20 w-20 rounded-xl object-cover ring-1 ring-slate-200" />
                  {!busy && (
                    <button
                      type="button"
                      onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-slate-900 text-white shadow"
                      aria-label="Remove photo"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isMobile && (
              <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()} className={cx(BTN_GHOST, "flex items-center gap-1.5")}>
                <Camera size={14} /> Camera
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => libraryRef.current?.click()} className={cx(BTN_GHOST, "flex items-center gap-1.5")}>
              <ImageIcon size={14} /> {isMobile ? "Photos" : "Add photos"}
            </button>
            <div className="flex-1" />
            <button type="button" disabled={!canGo || busy} onClick={run} className={cx(BTN_PRIMARY, "flex items-center gap-1.5")}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {busy ? "Working…" : "Format it"}
            </button>
          </div>

          <p className="mt-2 text-[12px] text-slate-400">
            {busy
              ? (isLink ? "Reading the page…" : images.length ? "Reading your photo" + (images.length > 1 ? "s" : "") + "… (10–20 seconds)" : "Tidying it up…")
              : isLink ? "Link detected — the recipe will be pulled from the page."
              : !isMobile ? "Tip: you can paste or drag a screenshot straight in. Multiple photos = pages of one recipe." : "Multiple photos are treated as pages of one recipe."}
          </p>
        </div>
      )}

      {stage === "review" && (
        <div className="flex flex-col gap-4">
          {drafts.map((d, i) => (
            <DraftEditor
              key={i}
              draft={d}
              onChange={(nd) => setDrafts((cur) => cur.map((x, j) => (j === i ? nd : x)))}
              onRemove={drafts.length > 1 ? () => setDrafts((cur) => cur.filter((_, j) => j !== i)) : null}
            />
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => { setStage("input"); setError(null); }} className={BTN_GHOST}>Back</button>
            <button type="button" disabled={saving || !drafts.length} onClick={save} className={cx(BTN_PRIMARY, "flex items-center gap-1.5")}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {drafts.length > 1 ? "Save all" : "Save recipe"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-red-50 p-3 text-[13px] text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </Sheet>
  );
}

/* ── Recipe page helpers: ingredient check-off and "ask about this recipe" ── */

/** Ingredients you can tap off while cooking. Saved on this device; clears itself after 12 hours. */
function IngredientChecklist({ recipeId, items }) {
  const KEY = "dl.ingChecks.v1";
  const load = () => {
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || "{}");
      const e = all[recipeId];
      return e && Date.now() - e.at < 12 * 3600 * 1000 ? new Set(e.checked) : new Set();
    } catch { return new Set(); }
  };
  const [checked, setChecked] = useState(load);
  useEffect(() => { setChecked(load()); }, [recipeId]);

  const save = (next) => {
    setChecked(next);
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (next.size) all[recipeId] = { checked: [...next], at: Date.now() }; else delete all[recipeId];
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* private mode */ }
  };
  const toggle = (i) => { const n = new Set(checked); n.has(i) ? n.delete(i) : n.add(i); save(n); };

  return (
    <>
      <ul>
        {items.map((ing, i) => {
          const on = checked.has(i);
          return (
            <li key={i} className="border-b border-slate-100 last:border-0">
              <button
                type="button"
                onClick={() => toggle(i)}
                className="flex w-full items-start gap-3 py-2 text-left"
              >
                <span className={cx(
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 transition-colors",
                  on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white ring-slate-300"
                )}>
                  {on && <Check size={13} strokeWidth={3} />}
                </span>
                <span className={cx("text-[14.5px] transition-colors", on ? "text-slate-400 line-through" : "text-slate-700")}>
                  {ing}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {checked.size > 0 && (
        <div className="mt-1 flex items-center justify-between text-[12px] text-slate-400">
          <span>{checked.size} of {items.length} added</span>
          <button type="button" onClick={() => save(new Set())} className="font-medium text-indigo-600 hover:underline">Uncheck all</button>
        </div>
      )}
    </>
  );
}

/** Chat about the recipe on screen. Answers can be saved into the recipe's notes. */
function AskRecipeSheet({ recipe, onClose, onSaveNote }) {
  const [messages, setMessages] = useState([]);   // [{ role, content }]
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedIdx, setSavedIdx] = useState(new Set());
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  const send = async (q) => {
    const text = (q ?? input).trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ask",
          recipe: {
            title: recipe.title, category: recipe.category, servings: recipe.servings,
            ingredients: recipe.ingredients, instructions: recipe.instructions, notes: recipe.notes, storage: recipe.storage,
          },
          messages: next,
        }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* ignore */ }
      if (!res.ok) throw new Error(data.error || "Couldn't get an answer (" + res.status + ")");
      setMessages([...next, { role: "assistant", content: data.answer }]);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const starters = ["What can I substitute if I'm missing something?", "How do I make this in cast iron?", "Can I make this ahead?", "How do I make it lower-glycemic?"];

  return (
    <Sheet title="Ask about this recipe" subtitle={recipe.title} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        {!messages.length && (
          <div className="flex flex-wrap gap-2">
            {starters.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}
                className="rounded-full bg-indigo-50 px-3 py-1.5 text-[12.5px] font-medium text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-100">
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cx(
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
              m.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800"
            )}>
              {m.content}
              {m.role === "assistant" && (
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={savedIdx.has(i)}
                    onClick={async () => { await onSaveNote(m.content); setSavedIdx((p) => new Set(p).add(i)); }}
                    className="text-[12px] font-semibold text-indigo-600 hover:underline disabled:text-emerald-600 disabled:no-underline"
                  >
                    {savedIdx.has(i) ? "✓ Saved to notes" : "+ Save to notes"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </div>
        )}
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <div ref={endRef} />

        <div className="sticky bottom-0 flex gap-2 bg-white pt-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask anything — swaps, timing, technique…"
            className={INPUT}
            autoFocus={!isMobile}
          />
          <button type="button" disabled={!input.trim() || busy} onClick={() => send()} className={cx(BTN_PRIMARY, "shrink-0")}>Ask</button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Recipe ideas: ask for a dish by name, or get suggestions, then add with one tap ── */

function IdeasSheet({ existingTitles, onAdd, onOpen, onClose }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(null);           // null | "dish" | "ideas" | "more"
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);       // [{ recipe, added: id|null, open: bool }]
  const [lastRequest, setLastRequest] = useState(null);

  const fetchIdeas = async (payload, kind, append = false) => {
    setBusy(kind); setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest", existing: existingTitles, ...payload }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* ignore */ }
      if (!res.ok) throw new Error(data.error || "No ideas came back (" + res.status + ")");
      const rows = (data.recipes || []).map((r) => ({ recipe: r, added: null, open: kind === "dish" }));
      setResults((cur) => (append ? [...cur, ...rows] : rows));
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  const writeDish = (dish) => {
    const d = (dish ?? input).trim(); if (!d) return;
    setLastRequest({ request: "Variations or close cousins of: " + d });
    fetchIdeas({ dish: d }, "dish");
  };
  const suggest = (req) => {
    const r = (req ?? input).trim();
    setLastRequest({ request: r });
    fetchIdeas({ request: r, count: 4 }, "ideas");
  };
  const more = () => fetchIdeas({ ...lastRequest, count: 4, exclude: results.map((x) => x.recipe.title) }, "more", true);

  const update = (i, patch) => setResults((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = async (i) => {
    const r = results[i].recipe;
    setError(null);
    try {
      const id = await onAdd({ ...r, baseServings: r.servings });
      update(i, { added: id });
    } catch (e) {
      setError("Couldn't save \u201c" + r.title + "\u201d: " + (e.message || e));
    }
  };

  const chips = ["Weeknight cast iron dinners", "High-protein, low-glycemic", "Soups for cold nights", "Something with fish", "Sunday comfort food"];

  return (
    <Sheet title="Recipe ideas" subtitle="Name a dish you want, or ask for suggestions" onClose={busy ? () => {} : onClose} wide>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && input.trim() && writeDish()}
        disabled={!!busy}
        placeholder='e.g. "fish chowder" or "easy chicken dinners"'
        className={INPUT}
        autoFocus={!isMobile}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!input.trim() || !!busy} onClick={() => writeDish()} className={cx(BTN_PRIMARY, "flex items-center gap-1.5")}>
          {busy === "dish" ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />} Write this recipe
        </button>
        <button type="button" disabled={!!busy} onClick={() => suggest()} className={cx(BTN_GHOST, "flex items-center gap-1.5")}>
          {busy === "ideas" ? <Loader2 size={14} className="animate-spin" /> : <Lightbulb size={14} />} {input.trim() ? "Suggest ideas" : "Surprise me"}
        </button>
      </div>

      {!results.length && !busy && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => { setInput(c); suggest(c); }}
              className="rounded-full bg-indigo-50 px-3 py-1.5 text-[12.5px] font-medium text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-100">
              {c}
            </button>
          ))}
        </div>
      )}

      {busy && busy !== "more" && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-slate-400">
          <Loader2 size={14} className="animate-spin" /> {busy === "dish" ? "Writing the recipe…" : "Coming up with ideas…"} (10–30 seconds)
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-red-50 p-3 text-[13px] text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-4 flex flex-col gap-2.5">
          {results.map(({ recipe: r, added, open }, i) => (
            <div key={i} className={cx(CARD, "overflow-hidden")}>
              <button type="button" onClick={() => update(i, { open: !open })} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold text-slate-900">{r.title}</div>
                  <div className="mt-0.5 text-[12px] text-slate-400">{catsOf(r).join(", ")} · serves {r.servings} · {r.ingredients.length} ingredients</div>
                  {r.summary && <div className="mt-1 text-[13px] text-slate-600">{r.summary}</div>}
                </div>
                <ChevronRight size={16} className={cx("mt-1 shrink-0 text-slate-300 transition-transform", open && "rotate-90")} />
              </button>

              {open && (
                <div className="animate-rise border-t border-slate-100 px-4 pb-4 pt-3">
                  <div className={cx(LABEL_SM, "mb-1")}>Ingredients</div>
                  <ul className="mb-3 list-disc pl-5 text-[13.5px] leading-relaxed text-slate-700">
                    {r.ingredients.map((x, k) => <li key={k}>{x}</li>)}
                  </ul>
                  <div className={cx(LABEL_SM, "mb-1")}>Steps</div>
                  <ol className="mb-3 list-decimal pl-5 text-[13.5px] leading-relaxed text-slate-700">
                    {r.instructions.map((x, k) => <li key={k} className="mb-1">{x}</li>)}
                  </ol>
                  {r.notes && <p className="mb-3 whitespace-pre-line text-[12.5px] text-slate-500">{r.notes}</p>}
                  {!added && (
                    <AiChangeBox getRecipe={() => r} onApply={(nr) => update(i, { recipe: { ...nr, summary: r.summary } })} />
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
                {added ? (
                  <>
                    <span className="flex items-center gap-1 text-[13px] font-semibold text-emerald-600"><Check size={14} /> Added as “{r.title}”</span>
                    <button type="button" onClick={() => onOpen(added)} className={BTN_GHOST}>Open</button>
                  </>
                ) : (
                  <button type="button" onClick={() => add(i)} className={cx(BTN_PRIMARY, "flex items-center gap-1.5")}>
                    <Plus size={14} /> Add to recipes
                  </button>
                )}
              </div>
            </div>
          ))}

          <button type="button" disabled={!!busy} onClick={more} className={cx(BTN_GHOST, "flex items-center justify-center gap-1.5")}>
            {busy === "more" ? <Loader2 size={14} className="animate-spin" /> : <Lightbulb size={14} />} More ideas like these
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* ── Assistant: chat that works the app through tools ── */

/** One-line description of a tool step, shown in the chat as the assistant works. */
const describeStep = (name, input = {}, recipeTitle, storeName = (x) => x) => {
  const t = (id) => recipeTitle(id) || "a recipe";
  switch (name) {
    case "search_recipes": return "Looked through your recipes" + (input.query ? " for “" + input.query + "”" : input.category ? " in " + input.category : "");
    case "get_recipe": return "Read " + t(input.id);
    case "create_recipe": return "Wrote and saved “" + (input.title || "a new recipe") + "”";
    case "update_recipe": return "Updated " + t(input.id);
    case "set_servings": return "Scaled " + t(input.id) + " to " + input.servings + " servings";
    case "add_recipe_to_list": return "Put " + t(input.id) + " on the Market Basket list";
    case "remove_recipe_from_list": return "Took " + t(input.id) + " off the list";
    case "add_items": return "Added " + (input.items || []).map((i) => (i.qty > 1 ? i.qty + " " : "") + i.name + " (" + storeName(i.store) + ")").join(", ");
    case "get_list": return "Checked the " + storeName(input.store) + " list";
    case "get_usuals": return "Checked your " + storeName(input.store) + " usuals";
    case "get_pantry": return "Checked your pantry staples";
    default: return name;
  }
};

function AssistantSheet({ messages, busy, error, onSend, onReset, onClose, recipeTitle, storeName }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  // Flatten the API-format history into chat bubbles and step lines.
  const rows = [];
  messages.forEach((m, i) => {
    if (m.role === "user") {
      if (typeof m.content === "string") rows.push({ kind: "user", text: m.content, k: i });
      return;
    }
    (m.content || []).forEach((b, j) => {
      if (b.type === "text" && b.text.trim()) rows.push({ kind: "assistant", text: b.text.trim(), k: i + "-" + j });
      if (b.type === "tool_use") rows.push({ kind: "step", text: describeStep(b.name, b.input, recipeTitle, storeName), k: i + "-" + j });
    });
  });

  const send = (q) => {
    const text = (q ?? input).trim();
    if (!text || busy) return;
    setInput("");
    onSend(text);
  };

  const starters = [
    "Plan 2 dinners for this week and put them on my list",
    "We're having 8 people Saturday — make the fish chowder and something for dessert",
    "What usuals am I due for? Add them",
    "Something high-protein in the cast iron tonight with what's on my list",
  ];

  return (
    <Sheet title="Assistant" subtitle="Ask it to plan, cook, or shop — it does the steps" onClose={busy ? () => {} : onClose} wide>
      <div className="flex flex-col gap-2.5">
        {!rows.length && (
          <div className="flex flex-col gap-1.5">
            {starters.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}
                className="rounded-xl bg-indigo-50 px-3.5 py-2.5 text-left text-[13px] font-medium text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100">
                {s}
              </button>
            ))}
          </div>
        )}

        {rows.map((r) =>
          r.kind === "step" ? (
            <div key={r.k} className="flex items-start gap-2 pl-1 text-[12.5px] text-slate-500">
              <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" /> <span>{r.text}</span>
            </div>
          ) : (
            <div key={r.k} className={cx("flex", r.kind === "user" ? "justify-end" : "justify-start")}>
              <div className={cx(
                "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
                r.kind === "user" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800"
              )}>
                {r.text}
              </div>
            </div>
          )
        )}

        {busy && (
          <div className="flex items-center gap-2 pl-1 text-[13px] text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Working on it…
          </div>
        )}
        {error && (
          <p className="flex items-start gap-1.5 rounded-xl bg-red-50 p-3 text-[13px] text-red-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
        <div ref={endRef} />

        <div className="sticky bottom-0 flex gap-2 bg-white pt-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={busy}
            placeholder="e.g. plan 2 dinners this week and add them to my list"
            className={INPUT}
            autoFocus={!isMobile}
          />
          <button type="button" disabled={!input.trim() || busy} onClick={() => send()} className={cx(BTN_PRIMARY, "shrink-0")}>Go</button>
        </div>
        {rows.length > 0 && !busy && (
          <button type="button" onClick={onReset} className="self-center text-[12px] font-medium text-slate-400 hover:text-slate-600">
            Start a new conversation
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** "Ask for a change" box: sends the recipe + request to the AI and hands back the revised recipe. */
function AiChangeBox({ getRecipe, onApply }) {
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState(null);

  const refine = async () => {
    if (!ask.trim() || asking) return;
    setAsking(true); setAskError(null);
    try {
      const [r] = await postImport({ mode: "refine", recipe: getRecipe(), instruction: ask.trim() });
      if (r) { onApply(r); setAsk(""); }
    } catch (e) { setAskError(e.message); }
    setAsking(false);
  };

  return (
    <div className="rounded-xl bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700">
        <Sparkles size={13} /> Ask for a change
      </div>
      <div className="flex gap-2">
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refine()}
          disabled={asking}
          placeholder="e.g. make it serve 2 · adapt for cast iron · lower-glycemic swaps"
          className={cx(INPUT, "text-[13.5px]")}
        />
        <button type="button" disabled={!ask.trim() || asking} onClick={refine} className={cx(BTN_PRIMARY, "shrink-0")}>
          {asking ? <Loader2 size={14} className="animate-spin" /> : "Apply"}
        </button>
      </div>
      <p className="mt-2 text-[11.5px] text-slate-400">
        {asking ? "Rewriting the recipe…" : "The fields update so you can check them. Nothing is saved until you tap Save."}
      </p>
      {askError && <p className="mt-1 text-[12px] text-red-600">{askError}</p>}
    </div>
  );
}

/** Pick one or more categories. The first one picked is the main category. */
function CategoryPicker({ value, onChange }) {
  const cur = catsOf({ categories: value });
  const toggle = (c) => {
    if (cur.includes(c)) { if (cur.length > 1) onChange(cur.filter((x) => x !== c)); }
    else onChange([...cur, c]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {RECIPE_CATS.map((c) => {
        const i = cur.indexOf(c);
        const on = i >= 0;
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            title={i === 0 ? "Main category" : on ? "Also shows here — tap to remove" : "Also show under " + c}
            className={cx(
              "rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 transition-colors",
              i === 0 ? "bg-indigo-600 text-white ring-indigo-600"
                : on ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                  : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
            )}
          >
            {on && <Check size={11} strokeWidth={3} className="-ml-0.5 mr-0.5 inline" />}{c}
          </button>
        );
      })}
    </div>
  );
}

/** One recipe in the review step: editable fields plus "ask for a change". */
function DraftEditor({ draft, onChange, onRemove }) {
  const set = (k) => (e) => onChange({ ...draft, [k]: e.target.value });
  const ingCount = draft.ingredients.split("\n").filter((l) => l.trim()).length;
  const stepCount = draft.instructions.split("\n").filter((l) => l.trim()).length;

  return (
    <div className={cx(CARD, "p-4")}>
      <div className="flex items-start gap-2">
        <input value={draft.title} onChange={set("title")} className={cx(INPUT, "text-[16px] font-semibold")} aria-label="Title" />
        {onRemove && <IconBtn icon={Trash2} title="Don't import this one" onClick={onRemove} />}
      </div>

      <div className="mt-3 grid grid-cols-[1fr_5rem] items-start gap-2">
        <Field label="Categories" hint="tap to add more">
          <CategoryPicker value={draft.cats} onChange={(cats) => onChange({ ...draft, cats })} />
        </Field>
        <Field label="Serves">
          <input type="number" min="1" value={draft.servings} onChange={set("servings")} className={INPUT} />
        </Field>
      </div>

      <div>
        <Field label={"Ingredients (" + ingCount + ")"} hint="One per line">
          <textarea value={draft.ingredients} onChange={set("ingredients")} className={cx(INPUT, "h-40 resize-y text-[13.5px] leading-relaxed")} />
        </Field>
      </div>
      <div>
        <Field label={"Steps (" + stepCount + ")"} hint="One per line">
          <textarea value={draft.instructions} onChange={set("instructions")} className={cx(INPUT, "h-48 resize-y text-[13.5px] leading-relaxed")} />
        </Field>
      </div>
      <div className="grid gap-x-3 md:grid-cols-2">
        <Field label="Notes">
          <textarea value={draft.notes} onChange={set("notes")} className={cx(INPUT, "h-20 resize-y text-[13px] leading-relaxed")} />
        </Field>
        <Field label="Storage">
          <textarea value={draft.storage} onChange={set("storage")} className={cx(INPUT, "h-20 resize-y text-[13px] leading-relaxed")} />
        </Field>
      </div>

      <AiChangeBox getRecipe={() => fromDraft(draft)} onApply={(r) => onChange(toDraft(r))} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. App
   ═══════════════════════════════════════════════════════════════════════════ */

export default function App() {
  return (
    <>
      <AppMain />
      <TimerTray />
    </>
  );
}

function AppMain() {
  /* ── State ─────────────────────────────────────────────────────────────── */
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sortAZ, setSortAZ] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("shopping");
  const [storeTab, setStoreTab] = useState("mb");
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const open = (e) => { setView("recipes"); setSelectedId(e.detail); };
    window.addEventListener("dl:open-recipe", open);
    return () => window.removeEventListener("dl:open-recipe", open);
  }, []);

  const [importOpen, setImportOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        if (searchRef.current) { e.preventDefault(); searchRef.current.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [checkedItems, setCheckedItems] = useState(new Set());
  /* Keys checked off during the current trip. Drives the progress counter so
     items left checked from earlier trips don't count. */
  const [tripChecked, setTripChecked] = useState(new Set());
  const [manualItems, setManualItems] = useState([]);
  const [removedKeys, setRemovedKeys] = useState(new Set());
  const [manualInput, setManualInput] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [editingQty, setEditingQty] = useState("");
  const shoppingLoaded = useRef(false);

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

  /* Custom stores */
  const [customStores, setCustomStores] = useState([]);
  const [storesError, setStoresError] = useState(null);
  const [storeEditor, setStoreEditor] = useState(null);   // null | {mode:"create"} | {mode:"edit", store}
  const [sectionPicker, setSectionPicker] = useState(null);
  const [customInput, setCustomInput] = useState({});
  const [customQty, setCustomQty] = useState({});

  const [wakeLock, setWakeLock] = useState(null);
  const [wakeActive, setWakeActive] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  /** Permanent keyword→aisle rules. Add-only from the UI — see AisleRulesModal. */
  const [aisleRules, setAisleRules] = useState({});
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pantry, setPantry] = useState([]);
  const [pantryOpen, setPantryOpen] = useState(false);
  const [aisleEditorItem, setAisleEditorItem] = useState(null);

  /* ── Effects ───────────────────────────────────────────────────────────── */
  useEffect(() => { window.scrollTo(0, 0); }, [view, storeTab]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setAuthReady(true);
      else signInAnonymously(auth).catch((err) => console.error("Anonymous sign-in failed:", err));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const run = async () => {
      const snap = await getDocs(collection(db, "recipes"));
      const batch = writeBatch(db);
      let need = false;
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.notes === undefined || data.storage === undefined) {
          batch.update(doc(db, "recipes", d.id), { notes: data.notes ?? "", storage: data.storage ?? "" });
          need = true;
        }
      });
      if (need) await batch.commit();
    };
    run();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(collection(db, "recipes"), (snap) => {
      setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data(), servings: d.data().servings || d.data().baseServings })));
      setLoading(false);
    });
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(doc(db, "app", "shopping"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCheckedIds(new Set(data.checkedIds || []));
        setCheckedItems(new Set(data.checkedItems || []));
        setTripChecked(new Set(data.tripChecked || []));
        setManualItems(data.manualItems || []);
        setRemovedKeys(new Set(data.removedKeys || []));
      }
      shoppingLoaded.current = true;
    });
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(doc(db, "app", "mbSettings"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.aisleRules) {
          // Drop rules keyed on a bare unit like "cup" — they'd drag every "... cup ..." item into one aisle.
          const bad = Object.keys(data.aisleRules).filter(isVagueName);
          if (bad.length) {
            const clean = { ...data.aisleRules };
            bad.forEach((k) => delete clean[k]);
            setAisleRules(clean);
            updateDoc(doc(db, "app", "mbSettings"), { aisleRules: clean }).catch(() => {});
          } else setAisleRules(data.aisleRules);
        }
        setPantry(Array.isArray(data.pantry) ? data.pantry : []);
        setUsuals(data.usuals && typeof data.usuals === "object" ? data.usuals : {});
      }
    });
    return () => unsub();
  }, [authReady]);

  /* Custom stores collection. The error callback matters: if Firestore rules
     don't allow /stores/**, this is where you'll see it. */
  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "stores"),
      (snap) => {
        setStoresError(null);
        setCustomStores(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        );
      },
      (err) => {
        console.error("stores listener failed:", err);
        setStoresError(err.code || "unavailable");
      }
    );
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(doc(db, "app", "target"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setTargetItems(data.items || []);
        setTargetChecked(new Set(data.checked || []));
        if (data.resetAt && !targetTimerRef.current) {
          const rem = data.resetAt - Date.now();
          if (rem <= 0) {
            resetTarget();
          } else {
            targetResetAtRef.current = data.resetAt;
            targetTimerRef.current = setInterval(() => {
              const r = data.resetAt - Date.now();
              if (r <= 0) { resetTarget(); return; }
              const m = Math.floor(r / 60000), s = Math.floor((r % 60000) / 1000);
              setTargetCountdown("resets in " + m + ":" + String(s).padStart(2, "0"));
            }, 1000);
          }
        }
      }
    });
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(doc(db, "app", "lowes"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLowesItems(data.items || []);
        setLowesChecked(new Set(data.checked || []));
        if (data.resetAt && !lowesTimerRef.current) {
          const rem = data.resetAt - Date.now();
          if (rem <= 0) {
            resetLowes();
          } else {
            lowesResetAtRef.current = data.resetAt;
            lowesTimerRef.current = setInterval(() => {
              const r = data.resetAt - Date.now();
              if (r <= 0) { resetLowes(); return; }
              const m = Math.floor(r / 60000), s = Math.floor((r % 60000) / 1000);
              setLowesCountdown("resets in " + m + ":" + String(s).padStart(2, "0"));
            }, 1000);
          }
        }
      }
    });
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    const tt = targetItems.length;
    const tc = targetItems.filter((i) => targetChecked.has(i.key)).length;
    if (tt > 0 && tc === tt) {
      if (targetTimerRef.current) return;
      const end = targetResetAtRef.current || Date.now() + 60 * 60 * 1000;
      targetResetAtRef.current = end;
      setDoc(doc(db, "app", "target"), { resetAt: end }, { merge: true });
      targetTimerRef.current = setInterval(() => {
        const rem = end - Date.now();
        if (rem <= 0) { resetTarget(); return; }
        const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
        setTargetCountdown("resets in " + m + ":" + String(s).padStart(2, "0"));
      }, 1000);
    } else {
      if (targetTimerRef.current) { clearInterval(targetTimerRef.current); targetTimerRef.current = null; }
      targetResetAtRef.current = null;
      setTargetCountdown(null);
    }
  }, [targetChecked, targetItems]);

  useEffect(() => {
    const lt = lowesItems.length;
    const lc = lowesItems.filter((i) => lowesChecked.has(i.key)).length;
    if (lt > 0 && lc === lt) {
      if (lowesTimerRef.current) return;
      const end = lowesResetAtRef.current || Date.now() + 60 * 60 * 1000;
      lowesResetAtRef.current = end;
      setDoc(doc(db, "app", "lowes"), { resetAt: end }, { merge: true });
      lowesTimerRef.current = setInterval(() => {
        const rem = end - Date.now();
        if (rem <= 0) { resetLowes(); return; }
        const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
        setLowesCountdown("resets in " + m + ":" + String(s).padStart(2, "0"));
      }, 1000);
    } else {
      if (lowesTimerRef.current) { clearInterval(lowesTimerRef.current); lowesTimerRef.current = null; }
      lowesResetAtRef.current = null;
      setLowesCountdown(null);
    }
  }, [lowesChecked, lowesItems]);

  useEffect(() => { setConfirmReset(false); }, [view, storeTab]);

  /* ── Store list ────────────────────────────────────────────────────────── */
  const navStores = useMemo(
    () => [...BUILTIN_STORES, ...customStores.map(toNavStore)],
    [customStores]
  );

  /**
   * If the active store is deleted (here or on another device), fall back to
   * Market Basket. A store we just created is exempt until its snapshot lands,
   * otherwise this guard would yank us off it during the round trip.
   */
  const pendingStoreRef = useRef(null);
  useEffect(() => {
    if (view !== "shopping") return;
    const known = navStores.some((s) => s.id === storeTab);
    if (known) { if (pendingStoreRef.current === storeTab) pendingStoreRef.current = null; return; }
    if (pendingStoreRef.current === storeTab) return;
    setStoreTab("mb");
  }, [navStores, storeTab, view]);

  /* ── Classification with permanent aisle rules ──────────────────────────── */
  const classifyWithRules = (text) => {
    const lower = text.toLowerCase();
    for (const [keyword, sectionKey] of Object.entries(aisleRules)) {
      if (lower.includes(keyword)) return sectionKey;
    }
    return classifyIngredient(text);
  };

  /* ── Persistence helpers ───────────────────────────────────────────────── */
  const saveShop = (u) => setDoc(doc(db, "app", "shopping"), u, { merge: true });
  const saveStore = (id, patch) =>
    setDoc(doc(db, "stores", id), patch, { merge: true }).catch((e) => console.error("store save failed:", e));

  /* ── Derived: Market Basket ────────────────────────────────────────────── */
  const rawShoppingItems = useMemo(() => {
    const items = [];
    recipes.filter((r) => checkedIds.has(r.id)).forEach((r) => {
      const ratio = r.servings / r.baseServings;
      r.ingredients.forEach((ing) => {
        const scaled = ratio !== 1 ? scaleIngredient(ing, ratio) : ing;
        const lower = ing.toLowerCase();
        if (lower.includes("salt and pepper") || lower.includes("salt & pepper")) {
          ["salt", "pepper"].forEach((item) => {
            const key = "r" + r.id + "::" + item;
            if (!removedKeys.has(key)) {
              items.push({ key, text: item, recipe: r.title, sectionKey: classifyWithRules(item), manual: false });
            }
          });
        } else {
          const key = "r" + r.id + "::" + ing;
          if (!removedKeys.has(key)) {
            items.push({ key, text: toShoppingText(scaled), recipe: r.title, sectionKey: classifyWithRules(ing), manual: false });
          }
        }
      });
    });
    manualItems.forEach((m) => {
      if (!removedKeys.has(m.key)) items.push({ ...m, sectionKey: classifyWithRules(m.text), manual: true });
    });
    return items;
  }, [checkedIds, recipes, manualItems, removedKeys, aisleRules]);

  /* Recipe ingredients that are pantry staples stay off the list (items you add by hand always show). */
  const allShoppingItems = useMemo(
    () => rawShoppingItems.filter((i) => i.manual || !isPantryStaple(i.text, pantry)),
    [rawShoppingItems, pantry]
  );
  const skippedStaples = useMemo(
    () => [...new Set(rawShoppingItems.filter((i) => !i.manual && isPantryStaple(i.text, pantry)).map((i) => i.text.toLowerCase()))],
    [rawShoppingItems, pantry]
  );
  /** "I always have this": add the item to pantry staples (recipe copies then drop off the list). */
  const markPantry = (item) => {
    const name = (parseAmount(item.text).name || item.text).replace(PREP_STRIP, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!name) return;
    if (!pantry.includes(name)) savePantry([...pantry, name]);
    // Hand-added items always show, so take this one off too.
    const manualKeys = (item.keys || [item.key]).filter((k) => k.startsWith("m"));
    if (manualKeys.length) removeKeys(manualKeys);
    showToast(<span>Added <b>{name}</b> to pantry staples. <span className="text-slate-400">Undo in ⋮ → Pantry staples.</span></span>);
  };

  const savePantry = (next) => {
    setPantry(next);
    setDoc(doc(db, "app", "mbSettings"), { pantry: next }, { merge: true }).catch((e) => console.error("pantry save failed:", e));
  };

  /**
   * Active (unchecked) rows, grouped by aisle. Only unchecked items are
   * combined, and each combined row carries the keys of every item it stands
   * for, so checking or removing "3 garlic" acts on all of them. (Previously
   * checked and unchecked items were combined together, so checking a
   * combined row could hide its other members while they still counted as
   * unchecked: the list showed everything done but stuck below 100%.)
   */
  const grouped = useMemo(() => {
    const g = {};
    STORE_SECTIONS.forEach((s) => { g[s.key] = []; });
    allShoppingItems
      .filter((item) => !checkedItems.has(item.key))
      .forEach((item) => { (g[item.sectionKey] || g["kitchen"]).push(item); });
    const groupOf = (i) => { const p = parseAmount(i.text); return p.name + "|" + (p.unit || ""); };
    const c = {};
    Object.keys(g).forEach((k) => {
      const items = combineItems(g[k]).map((row) => ({
        ...row,
        keys: g[k].filter((i) => groupOf(i) === row.parsed.name + "|" + (row.unit || "")).map((i) => i.key),
      }));
      c[k] = k === "produce" ? produceSubSort(items) : items;
    });
    return c;
  }, [allShoppingItems, checkedItems]);

  const total = allShoppingItems.length;
  const activeSections = STORE_SECTIONS.filter((s) => grouped[s.key]?.some((i) => !checkedItems.has(i.key)));
  /* Completed rows, alphabetized by item name (leading quantity ignored). */
  const completedItems = allShoppingItems
    .filter((i) => checkedItems.has(i.key))
    .sort((a, b) => {
      const an = (parseAmount(a.text).name || a.text).toLowerCase();
      const bn = (parseAmount(b.text).name || b.text).toLowerCase();
      return an.localeCompare(bn) || a.text.localeCompare(b.text);
    });
  /* Progress = items checked off this trip / (those + rows still active).
     Starts at 0/N, climbs to N/N, then drops to 0/0 once nothing is left.
     Items checked on a previous trip are not counted. Combined rows count
     once, matching what's on screen. */
  const activeRowCount = STORE_SECTIONS.reduce((n, s) => n + (grouped[s.key]?.length || 0), 0);
  const checked = new Set(
    completedItems
      .filter((i) => tripChecked.has(i.key))
      .map((i) => { const p = parseAmount(i.text); return i.sectionKey + "|" + p.name + "|" + (p.unit || ""); })
  ).size;
  const listTotal = activeRowCount + checked;
  const pct = listTotal > 0 ? Math.round((checked / listTotal) * 100) : 0;

  /* Trip finished: hold N/N briefly, then clear the trip so it reads 0/0. */
  useEffect(() => {
    if (activeRowCount > 0 || tripChecked.size === 0) return;
    const t = setTimeout(() => {
      setTripChecked(new Set());
      saveShop({ tripChecked: [] });
    }, 2500);
    return () => clearTimeout(t);
  }, [activeRowCount, tripChecked]);

  /* ── Sidebar counts ────────────────────────────────────────────────────── */
  const navCounts = useMemo(() => {
    const c = {
      mb: allShoppingItems.filter((i) => !checkedItems.has(i.key)).length,
      target: targetItems.filter((i) => !targetChecked.has(i.key)).length,
      lowes: lowesItems.filter((i) => !lowesChecked.has(i.key)).length,
    };
    customStores.forEach((s) => {
      const done = new Set(s.checked || []);
      c[s.id] = (s.items || []).filter((i) => !done.has(i.key)).length;
    });
    return c;
  }, [allShoppingItems, checkedItems, targetItems, targetChecked, lowesItems, lowesChecked, customStores]);

  /**
   * Aisle reassignment. Tapping an item's badge sets a permanent keyword→aisle
   * rule keyed on that item's own text, so it (and every future occurrence of
   * it) lands in the chosen aisle from then on. There is deliberately no
   * "clear all" action anywhere — deleteAisleRule removes one at a time from
   * the review screen, so a stray tap can't wipe out everything you've set.
   */
  const handleAislePick = (item) => setAisleEditorItem(item);

  const handleAisleSelect = (newSectionKey) => {
    if (!aisleEditorItem) return;
    const keyword = aisleEditorItem.text.toLowerCase().replace(/^\d+\s+/, "").trim();
    const next = { ...aisleRules, [keyword]: newSectionKey };
    setAisleRules(next);
    setDoc(doc(db, "app", "mbSettings"), { aisleRules: next }, { merge: true });
    setAisleEditorItem(null);
  };

  const deleteAisleRule = (keyword) => {
    const next = { ...aisleRules };
    delete next[keyword];
    setAisleRules(next);
    // updateDoc replaces the whole map, so the deleted rule is really gone (setDoc+merge kept it).
    updateDoc(doc(db, "app", "mbSettings"), { aisleRules: next })
      .catch(() => setDoc(doc(db, "app", "mbSettings"), { aisleRules: next }, { merge: true }));
  };

  /* ── Market Basket mutations ───────────────────────────────────────────── */
  const resetShopping = () => {
    const e = { checkedIds: [], checkedItems: [], tripChecked: [], manualItems: [], removedKeys: [], resetAt: null };
    setCheckedIds(new Set()); setCheckedItems(new Set()); setTripChecked(new Set()); setManualItems([]);
    setRemovedKeys(new Set()); setEditingKey(null); saveShop(e);
  };

  /**
   * Put a recipe on (or take it off) the Market Basket list. Either way its items start fresh:
   * anything from that recipe you'd checked off or removed is forgotten, so re-adding it brings
   * back the full ingredient list (pantry staples are still left off).
   */
  const setRecipeOnList = (id, on) => {
    const mine = (k) => k.startsWith("r" + id + "::");
    setCheckedIds((p) => { const n = new Set(p); on ? n.add(id) : n.delete(id); saveShop({ checkedIds: [...n] }); return n; });
    setRemovedKeys((p) => { const n = new Set([...p].filter((k) => !mine(k))); if (n.size !== p.size) saveShop({ removedKeys: [...n] }); return n; });
    setCheckedItems((p) => { const n = new Set([...p].filter((k) => !mine(k))); if (n.size !== p.size) saveShop({ checkedItems: [...n] }); return n; });
    setTripChecked((p) => { const n = new Set([...p].filter((k) => !mine(k))); if (n.size !== p.size) saveShop({ tripChecked: [...n] }); return n; });
  };

  const toggleCheck = (id, e) => {
    e?.stopPropagation();
    setRecipeOnList(id, !checkedIds.has(id));
  };

  /** Add keys to (on) or drop them from (off) the current trip. */
  const updateTrip = (keys, on) => {
    setTripChecked((p) => {
      const n = new Set(p);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      saveShop({ tripChecked: [...n] });
      return n;
    });
  };

  const toggleItem = (key) => {
    updateTrip([key], !checkedItems.has(key));
    setCheckedItems((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); saveShop({ checkedItems: [...n] }); return n; });
  };

  /** Check (or uncheck) every item behind a combined row at once. */
  const toggleKeys = (keys) => {
    updateTrip(keys, !keys.every((k) => checkedItems.has(k)));
    setCheckedItems((p) => {
      const n = new Set(p);
      const allOn = keys.every((k) => n.has(k));
      keys.forEach((k) => (allOn ? n.delete(k) : n.add(k)));
      saveShop({ checkedItems: [...n] });
      return n;
    });
  };

  const removeKeys = (keys) => {
    updateTrip(keys, false);
    setRemovedKeys((p) => { const n = new Set(p); keys.forEach((k) => n.add(k)); saveShop({ removedKeys: [...n] }); return n; });
    setCheckedItems((p) => { const n = new Set(p); keys.forEach((k) => n.delete(k)); saveShop({ checkedItems: [...n] }); return n; });
  };

  const removeItem = (key) => {
    updateTrip([key], false);
    setRemovedKeys((p) => { const n = new Set(p); n.add(key); saveShop({ removedKeys: [...n] }); return n; });
    setCheckedItems((p) => { const n = new Set(p); n.delete(key); saveShop({ checkedItems: [...n] }); return n; });
  };

  const startEdit = (key, text, e) => {
    e.stopPropagation();
    const match = text.match(/^(\d+)\s+(.+)$/);
    setEditingKey(key);
    setEditingText(match ? match[2] : text);
    setEditingQty(match ? match[1] : "");
  };

  /**
   * Save an edited Market Basket row. A row can be a manual item, a recipe
   * ingredient, or several of those combined into one line ("3 garlic").
   * Manual-only edits update the item in place. Anything involving recipe
   * ingredients replaces the whole row with one manual item carrying the new
   * text, and hides the recipe originals (same as tapping remove), so the
   * new quantity sticks instead of being recomputed from the recipe.
   */
  const editSavingRef = useRef(false);
  const saveEdit = (key) => {
    if (editSavingRef.current) return; // OK + blur can fire together
    editSavingRef.current = true;
    setTimeout(() => { editSavingRef.current = false; }, 0);

    const done = () => { setEditingKey(null); setEditingQty(""); };
    const name = editingText.trim();
    if (!name) { done(); return; }
    const qty = parseInt(editingQty) || 1;
    // Keep an explicit "1" in front of a unit ("1 lb ground beef"), drop it otherwise ("milk").
    const startsWithUnit = /^(lb|lbs|oz|can|cans|cup|cups|tbsp|tsp|clove|cloves|stalk|stalks|head|heads|bunch|bunches|piece|pieces|pkg|bag|bags|box|boxes|jar|jars|bottle|bottles|gallon|gallons)\b/i.test(name);
    const finalText = qty > 1 || startsWithUnit ? qty + " " + name : name;

    const orig = allShoppingItems.find((i) => i.key === key);
    if (!orig) { done(); return; }

    // Every underlying item that combineItems merged into this displayed row.
    const groupOf = (i) => { const p = parseAmount(i.text); return p.name + "|" + (p.unit || ""); };
    const g = groupOf(orig);
    const members = allShoppingItems.filter(
      (i) => i.sectionKey === orig.sectionKey && !checkedItems.has(i.key) && groupOf(i) === g
    );
    const memberKeys = new Set(members.map((m) => m.key));

    // Simple case: one manual item. Update it where it is.
    if (members.length === 1 && orig.manual) {
      if (orig.text !== finalText) {
        const u = manualItems.map((m) => (m.key === key ? { ...m, text: finalText } : m));
        setManualItems(u); saveShop({ manualItems: u });
      }
      done(); return;
    }

    // Recipe and/or combined rows: replace them with one manual item.
    const keepKey = orig.manual ? orig.key : "m" + Date.now();
    const recipeLabel = members.find((m) => !m.manual)?.recipe || orig.recipe || "Added manually";
    const u = [
      ...manualItems.filter((m) => !memberKeys.has(m.key)),
      { key: keepKey, text: finalText, recipe: recipeLabel, manual: true },
    ];
    const recipeKeys = members.filter((m) => !m.manual).map((m) => m.key);
    const nRemoved = new Set([...removedKeys, ...recipeKeys]);
    const nChecked = new Set([...checkedItems].filter((k) => !memberKeys.has(k)));

    setManualItems(u); setRemovedKeys(nRemoved); setCheckedItems(nChecked);
    saveShop({ manualItems: u, removedKeys: [...nRemoved], checkedItems: [...nChecked] });
    done();
  };

  const saveCompletedQty = (key, rawQty) => {
    const target = manualItems.find((m) => m.key === key);
    if (!target) return;
    const bare = String(target.text).replace(/^\d+\s+/, "").trim();
    const qty = parseInt(rawQty) || 1;
    const finalText = qty > 1 ? qty + " " + bare : bare;
    if (finalText === target.text) return;
    const u = manualItems.map((m) => (m.key === key ? { ...m, text: finalText } : m));
    setManualItems(u); saveShop({ manualItems: u });
  };

  const addManual = () => {
    if (!manualInput.trim()) return;
    const qty = parseInt(manualQty) || 1;
    const text = qty > 1 ? qty + " " + manualInput.trim() : manualInput.trim();
    const item = { key: "m" + Date.now(), text, recipe: "Added manually", manual: true };
    const u = [...manualItems, item];
    setManualItems(u); saveShop({ manualItems: u }); setManualInput(""); setManualQty("");
  };

  /* ── Target / Lowe's mutations ─────────────────────────────────────────── */
  const addTargetItem = () => {
    if (!targetInput.trim()) return;
    const qty = parseInt(targetQty) || 1;
    const text = qty > 1 ? qty + " " + targetInput.trim() : targetInput.trim();
    const item = { key: "t" + Date.now(), text, category: classifyTarget(targetInput.trim()) };
    const u = [...targetItems, item];
    setTargetItems(u);
    setDoc(doc(db, "app", "target"), { items: u, checked: [...targetChecked] }, { merge: true });
    setTargetInput(""); setTargetQty("");
  };

  const toggleTargetItem = (key) => {
    setTargetChecked((p) => {
      const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key);
      setDoc(doc(db, "app", "target"), { checked: [...n] }, { merge: true });
      return n;
    });
  };

  const removeTargetItem = (key) => {
    const u = targetItems.filter((i) => i.key !== key);
    setTargetItems(u);
    setTargetChecked((p) => { const n = new Set(p); n.delete(key); return n; });
    setDoc(doc(db, "app", "target"), { items: u, checked: [...targetChecked].filter((k) => k !== key) }, { merge: true });
  };

  const resetTarget = () => {
    setTargetItems([]); setTargetChecked(new Set()); setTargetCountdown(null);
    if (targetTimerRef.current) { clearInterval(targetTimerRef.current); targetTimerRef.current = null; }
    targetResetAtRef.current = null;
    setDoc(doc(db, "app", "target"), { items: [], checked: [], resetAt: null });
  };

  const addLowesItem = () => {
    if (!lowesInput.trim()) return;
    const qty = parseInt(lowesQty) || 1;
    const text = qty > 1 ? qty + " " + lowesInput.trim() : lowesInput.trim();
    const item = { key: "l" + Date.now(), text, category: classifyLowes(lowesInput.trim()) };
    const u = [...lowesItems, item];
    setLowesItems(u);
    setDoc(doc(db, "app", "lowes"), { items: u, checked: [...lowesChecked] }, { merge: true });
    setLowesInput(""); setLowesQty("");
  };

  const toggleLowesItem = (key) => {
    setLowesChecked((p) => {
      const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key);
      setDoc(doc(db, "app", "lowes"), { checked: [...n] }, { merge: true });
      return n;
    });
  };

  const removeLowesItem = (key) => {
    const u = lowesItems.filter((i) => i.key !== key);
    setLowesItems(u);
    setLowesChecked((p) => { const n = new Set(p); n.delete(key); return n; });
    setDoc(doc(db, "app", "lowes"), { items: u, checked: [...lowesChecked].filter((k) => k !== key) }, { merge: true });
  };

  const resetLowes = () => {
    setLowesItems([]); setLowesChecked(new Set()); setLowesCountdown(null);
    if (lowesTimerRef.current) { clearInterval(lowesTimerRef.current); lowesTimerRef.current = null; }
    lowesResetAtRef.current = null;
    setDoc(doc(db, "app", "lowes"), { items: [], checked: [], resetAt: null });
  };

  /* ── Custom store mutations ────────────────────────────────────────────── */
  const createStore = (payload) => {
    const id = "s" + Date.now();
    pendingStoreRef.current = id;
    setStoreTab(id);
    setView("shopping");
    setDoc(doc(db, "stores", id), { ...payload, items: [], checked: [], createdAt: Date.now() })
      .catch((e) => {
        console.error("store create failed:", e);
        setStoresError(e.code || "permission-denied");
        pendingStoreRef.current = null;
        setStoreTab("mb");
      });
    setStoreEditor(null);
  };

  const updateStore = (id, payload) => { saveStore(id, payload); setStoreEditor(null); };

  const removeStore = (id) => {
    deleteDoc(doc(db, "stores", id)).catch((e) => console.error("store delete failed:", e));
    setStoreEditor(null);
    setStoreTab("mb");
  };

  const addCustomItem = (store) => {
    const raw = (customInput[store.id] || "").trim();
    if (!raw) return;
    const qty = parseInt(customQty[store.id]) || 1;
    const text = qty > 1 ? qty + " " + raw : raw;
    const item = { key: "c" + Date.now(), text, sectionKey: null };
    saveStore(store.id, { items: [...store.items, item] });
    setCustomInput((p) => ({ ...p, [store.id]: "" }));
    setCustomQty((p) => ({ ...p, [store.id]: "" }));
  };

  const toggleCustomItem = (store, key) => {
    const next = store.checked.includes(key)
      ? store.checked.filter((k) => k !== key)
      : [...store.checked, key];
    saveStore(store.id, { checked: next });
  };

  const removeCustomItem = (store, key) => {
    saveStore(store.id, {
      items: store.items.filter((i) => i.key !== key),
      checked: store.checked.filter((k) => k !== key),
    });
  };

  const setCustomItemSection = (store, key, sectionKey) => {
    saveStore(store.id, {
      items: store.items.map((i) => (i.key === key ? { ...i, sectionKey } : i)),
    });
    setSectionPicker(null);
  };

  const resetCustomStore = (store) => saveStore(store.id, { items: [], checked: [] });

  /* ── AI list helpers: say/type several items, AI aisle placement, usuals ── */
  const [usuals, setUsuals] = useState({});          // { storeId: { name: { n, t:[ts], q, s, label, hidden } } }
  const [usualsOpen, setUsualsOpen] = useState(false);
  const [smartBusy, setSmartBusy] = useState(false);
  const [listToast, setListToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = (msg) => {
    setListToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setListToast(null), 5000);
  };

  const sectionsOf = (st) =>
    st.id === "mb" ? STORE_SECTIONS.map(({ key, label }) => ({ key, label }))
      : st.id === "target" ? TARGET_CATEGORIES.map(({ key, label }) => ({ key, label: stripEmoji(label) }))
        : st.id === "lowes" ? LOWES_CATEGORIES.map(({ key, label }) => ({ key, label: stripEmoji(label) }))
          : (st.sections || []).map(({ key, label }) => ({ key, label }));
  const aiStores = useMemo(
    () => navStores.map((st) => ({ id: st.id, name: st.label, sections: sectionsOf(st) })),
    [navStores]
  );

  /** Remember what gets added, per store, so "usuals" can be suggested later. */
  const recordUsuals = (storeId, entries) => {
    setUsuals((prev) => {
      const now = Date.now();
      const mine = { ...(prev[storeId] || {}) };
      entries.forEach(({ name, qty, section }) => {
        const k = usualName(name);
        if (!k) return;
        const u = mine[k] || { n: 0, t: [] };
        const t = u.t || [];
        const sameTrip = t.length && now - t[t.length - 1] < 6 * 3600 * 1000; // re-adding the same day counts once
        mine[k] = {
          ...u,
          label: String(name).replace(/^[\d./\s]+/, "").trim() || k,
          q: qty || 1,
          ...(section ? { s: section } : {}),
          n: sameTrip ? u.n || 1 : (u.n || 0) + 1,
          t: sameTrip ? t : [...t, now].slice(-6),
          hidden: false,
        };
      });
      setDoc(doc(db, "app", "mbSettings"), { usuals: { [storeId]: mine } }, { merge: true })
        .catch((e) => console.error("usuals save failed:", e));
      return { ...prev, [storeId]: mine };
    });
  };
  const forgetUsual = (storeId, name) => {
    setUsuals((prev) => {
      const mine = { ...(prev[storeId] || {}) };
      if (mine[name]) mine[name] = { ...mine[name], hidden: true };
      setDoc(doc(db, "app", "mbSettings"), { usuals: { [storeId]: mine } }, { merge: true }).catch(() => {});
      return { ...prev, [storeId]: mine };
    });
  };

  /** Add parsed items to any store's list. entries: [{ name, qty, store, section }] */
  const addEntries = (entries) => {
    const byStore = {};
    entries.forEach((e) => { (byStore[e.store] = byStore[e.store] || []).push(e); });
    const stamp = Date.now();
    const label = (e) => (e.qty > 1 ? e.qty + " " + e.name : e.name);

    Object.entries(byStore).forEach(([sid, list]) => {
      if (sid === "mb") {
        const added = list.map((e, i) => ({ key: "m" + stamp + "_" + i, text: label(e), recipe: "Added manually", manual: true }));
        const u = [...manualItems, ...added];
        setManualItems(u); saveShop({ manualItems: u });
        const rules = {};
        list.forEach((e) => {
          if (e.section && !isVagueName(usualName(e.name)) && classifyWithRules(e.name) !== e.section) rules[usualName(e.name)] = e.section;
        });
        if (Object.keys(rules).length) {
          setAisleRules((prev) => ({ ...prev, ...rules }));
          setDoc(doc(db, "app", "mbSettings"), { aisleRules: rules }, { merge: true });
        }
      } else if (sid === "target" || sid === "lowes") {
        const cats = sid === "target" ? TARGET_CATEGORIES : LOWES_CATEGORIES;
        const cls = sid === "target" ? classifyTarget : classifyLowes;
        const added = list.map((e, i) => ({
          key: (sid === "target" ? "t" : "l") + stamp + "_" + i,
          text: label(e),
          category: cats.some((c) => c.key === e.section && c.key !== "other") ? e.section : cls(e.name),
        }));
        if (sid === "target") {
          const u = [...targetItems, ...added];
          setTargetItems(u);
          setDoc(doc(db, "app", "target"), { items: u, checked: [...targetChecked] }, { merge: true });
        } else {
          const u = [...lowesItems, ...added];
          setLowesItems(u);
          setDoc(doc(db, "app", "lowes"), { items: u, checked: [...lowesChecked] }, { merge: true });
        }
      } else {
        const st = navStores.find((x) => x.id === sid);
        if (!st) return;
        const added = list.map((e, i) => ({
          key: "c" + stamp + "_" + i,
          text: label(e),
          sectionKey: st.sections.some((x) => x.key === e.section) ? e.section : null,
        }));
        saveStore(sid, { items: [...st.items, ...added] });
      }
      recordUsuals(sid, list);
    });
  };

  const storeLabel = (sid) => navStores.find((x) => x.id === sid)?.label || sid;

  /** Hand free-form text (typed or spoken) to the AI and add whatever it finds. */
  const smartAdd = async (text, clearInput) => {
    setSmartBusy(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "items", text, currentStore: storeTab, stores: aiStores }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* ignore */ }
      if (!res.ok) throw new Error(data.error || "AI unavailable");
      addEntries(data.items);
      clearInput?.();
      const groups = {};
      data.items.forEach((i) => { (groups[i.store] = groups[i.store] || []).push(i.qty > 1 ? i.qty + " " + i.name : i.name); });
      showToast(
        <span>
          <b>Added:</b>{" "}
          {Object.entries(groups).map(([sid, names], k) => (
            <span key={sid}>{k > 0 && " · "}{names.join(", ")} <span className="text-slate-400">→ {storeLabel(sid)}</span></span>
          ))}
        </span>
      );
    } catch (e) {
      // AI down: add it as typed, as one item, so nothing is lost.
      addEntries([{ name: text, qty: 1, store: storeTab, section: "" }]);
      clearInput?.();
      showToast("Added as one item (" + (e.message || "AI unavailable") + ")");
    }
    setSmartBusy(false);
  };

  /* AI aisle placement: anything the keyword rules can't place gets one quiet AI pass. */
  const placedRef = useRef(null);
  if (placedRef.current === null) {
    try { placedRef.current = new Set(JSON.parse(localStorage.getItem("dl.placed.v1") || "[]")); }
    catch { placedRef.current = new Set(); }
  }
  const isMbUnplaced = (text) => {
    const lower = text.toLowerCase();
    if (Object.keys(aisleRules).some((k) => lower.includes(k))) return false;
    return classifyIngredient(text) === "kitchen" && !(KEYWORD_MAP.kitchen || []).some((k) => lower.includes(k));
  };

  useEffect(() => {
    if (!authReady) return;
    const fresh = (sid, texts) =>
      [...new Set(texts.map(usualName))].filter((t) => t && !isVagueName(t) && !placedRef.current.has(sid + "::" + t)).slice(0, 40);
    const jobs = [];
    const mb = fresh("mb", allShoppingItems.filter((i) => isMbUnplaced(i.text)).map((i) => parseAmount(i.text).name || i.text));
    if (mb.length) jobs.push({ sid: "mb", texts: mb });
    const tg = fresh("target", targetItems.filter((i) => i.category === "other").map((i) => i.text));
    if (tg.length) jobs.push({ sid: "target", texts: tg });
    const lw = fresh("lowes", lowesItems.filter((i) => i.category === "other").map((i) => i.text));
    if (lw.length) jobs.push({ sid: "lowes", texts: lw });
    navStores.filter((st) => !st.builtIn && st.sections.length).forEach((st) => {
      const cs = fresh(st.id, st.items.filter((i) => !i.sectionKey || !st.sections.some((x) => x.key === i.sectionKey)).map((i) => i.text));
      if (cs.length) jobs.push({ sid: st.id, texts: cs });
    });
    if (!jobs.length) return;

    const timer = setTimeout(async () => {
      for (const job of jobs) {
        job.texts.forEach((t) => placedRef.current.add(job.sid + "::" + t));
        try { localStorage.setItem("dl.placed.v1", JSON.stringify([...placedRef.current].slice(-1500))); } catch { /* ignore */ }
        const st = aiStores.find((x) => x.id === job.sid);
        if (!st) continue;
        let placements = [];
        try {
          const res = await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "place", store: st, items: job.texts }),
          });
          if (!res.ok) continue;
          placements = (await res.json()).placements || [];
        } catch { continue; }
        const where = Object.fromEntries(placements.map((p) => [p.text, p.section]));

        if (job.sid === "mb") {
          const rules = {};
          placements.forEach((p) => { if (p.section !== "kitchen" && !isVagueName(p.text)) rules[p.text] = p.section; });
          if (Object.keys(rules).length) {
            setAisleRules((prev) => ({ ...prev, ...rules }));
            setDoc(doc(db, "app", "mbSettings"), { aisleRules: rules }, { merge: true });
          }
        } else if (job.sid === "target" || job.sid === "lowes") {
          const setFn = job.sid === "target" ? setTargetItems : setLowesItems;
          setFn((prev) => {
            const u = prev.map((i) => (i.category === "other" && where[usualName(i.text)] && where[usualName(i.text)] !== "other"
              ? { ...i, category: where[usualName(i.text)] } : i));
            setDoc(doc(db, "app", job.sid), { items: u }, { merge: true });
            return u;
          });
        } else {
          const cur = navStores.find((x) => x.id === job.sid);
          if (!cur) continue;
          saveStore(job.sid, {
            items: cur.items.map((i) => (!i.sectionKey && where[usualName(i.text)] ? { ...i, sectionKey: where[usualName(i.text)] } : i)),
          });
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [allShoppingItems, targetItems, lowesItems, navStores, aisleRules, authReady]);

  /* ── Recipes ───────────────────────────────────────────────────────────── */
  const toggleFav = async (id, e) => {
    e && e.stopPropagation();
    const r = recipes.find((x) => x.id === id);
    if (!r) return;
    await updateDoc(doc(db, "recipes", id), { favorite: !r.favorite });
  };

  const setServings = (id, val) => {
    const v = Math.max(1, val);
    setRecipes((rs) => rs.map((r) => (r.id === id ? { ...r, servings: v } : r)));
    updateDoc(doc(db, "recipes", id), { servings: v });
  };

  const toggleWakeLock = async () => {
    if (wakeActive && wakeLock) {
      await wakeLock.release(); setWakeLock(null); setWakeActive(false);
    } else {
      try {
        if ("wakeLock" in navigator) {
          const lock = await navigator.wakeLock.request("screen");
          setWakeLock(lock); setWakeActive(true);
          lock.addEventListener("release", () => { setWakeActive(false); setWakeLock(null); });
        }
      } catch (e) { /* ignore */ }
    }
  };

  /** Save imported recipes; returns the new document ids. */
  const saveRecipesToFirestore = async (nr) => {
    const batch = writeBatch(db);
    const stamp = Date.now();
    const ids = nr.map((r, i) => {
      const id = "recipe_" + stamp + "_" + i;
      batch.set(doc(db, "recipes", id), {
        title: r.title, category: catsOf(r)[0], categories: catsOf(r), baseServings: r.baseServings, servings: r.servings,
        ingredients: r.ingredients, instructions: r.instructions, favorite: false,
        notes: r.notes || "", storage: r.storage || "",
      });
      return id;
    });
    await batch.commit();
    return ids;
  };

  const handleImportSave = async (nr) => {
    const ids = await saveRecipesToFirestore(nr);
    setImportOpen(false);
    if (ids.length === 1) setSelectedId(ids[0]);
  };

  const startEditRecipe = (r) => {
    setEditDraft({
      title: r.title, cats: catsOf(r), servings: r.servings, baseServings: r.baseServings,
      ingredients: r.ingredients.join("\n"), instructions: r.instructions.join("\n"),
      notes: r.notes || "", storage: r.storage || "",
    });
    setEditingRecipeId(r.id);
  };

  const saveEditRecipe = async (id) => {
    await updateDoc(doc(db, "recipes", id), {
      title: editDraft.title.trim(),
      category: catsOf({ categories: editDraft.cats })[0],
      categories: catsOf({ categories: editDraft.cats }),
      servings: Math.max(1, parseInt(editDraft.servings) || 1),
      baseServings: Math.max(1, parseInt(editDraft.baseServings) || parseInt(editDraft.servings) || 1),
      ingredients: editDraft.ingredients.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean),
      instructions: editDraft.instructions.split("\n").map((l) => l.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean),
      notes: editDraft.notes || "",
      storage: editDraft.storage || "",
    });
    setEditingRecipeId(null); setEditDraft(null);
  };

  const cancelEditRecipe = () => { setEditingRecipeId(null); setEditDraft(null); };

  const deleteRecipe = async (id) => {
    await deleteDoc(doc(db, "recipes", id));
    setSelectedId(null); setConfirmDelete(false);
  };

  const favCount = recipes.filter((r) => r.favorite).length;
  /* Search looks across every recipe (title, categories, ingredients, notes), whatever tab is
     open. Every word must match somewhere; title hits rank first. Plurals are forgiven. */
  const searchWords = search.toLowerCase().split(/[\s,]+/).map((w) => w.trim()).filter((w) => w.length > 1);
  const filtered = useMemo(() => {
    const byName = (a, b) => (sortAZ ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
    if (searchWords.length) {
      const stem = (w) => w.replace(/(es|s)$/, "");
      const has = (hay, w) => hay.includes(w) || hay.includes(stem(w));
      return recipes
        .map((r) => {
          const title = r.title.toLowerCase();
          const cats = catsOf(r).join(" ").toLowerCase();
          const ings = r.ingredients.join(" | ").toLowerCase();
          const rest = ((r.notes || "") + " " + r.instructions.join(" ")).toLowerCase();
          if (!searchWords.every((w) => has(title, w) || has(cats, w) || has(ings, w) || has(rest, w))) return null;
          const score = searchWords.reduce((n, w) => n + (has(title, w) ? 4 : has(cats, w) ? 2 : has(ings, w) ? 1 : 0), 0);
          const hit = r.ingredients.find((i) => searchWords.some((w) => has(i.toLowerCase(), w) && !has(title, w)));
          return { ...r, _score: score, _hit: hit };
        })
        .filter(Boolean)
        .sort((a, b) => b._score - a._score || byName(a, b));
    }
    let list = recipes;
    if (activeTab === "Favorites") list = list.filter((r) => r.favorite);
    else if (activeTab !== "All") list = list.filter((r) => catsOf(r).includes(activeTab));
    return [...list].sort(byName);
  }, [recipes, activeTab, search, sortAZ]);

  const selected = recipes.find((r) => r.id === selectedId);

  /* ── Shared chrome ─────────────────────────────────────────────────────── */
  /* ── Assistant: the agent loop. The worker decides; these functions act. ── */
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [agentMsgs, setAgentMsgs] = useState([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState(null);

  // Tools run against the latest state: refreshed every render, read at call time.
  const agentRef = useRef({});
  agentRef.current = {
    recipes, checkedIds, checkedItems, allShoppingItems, skippedStaples, pantry, usuals,
    targetItems, targetChecked, lowesItems, lowesChecked, navStores,
    addEntries, setServings, saveRecipesToFirestore, setRecipeOnList,
  };
  const recipeTitle = (id) => agentRef.current.recipes.find((r) => r.id === id)?.title;

  const runTool = async (name, input = {}) => {
    const A = agentRef.current;
    const findR = (id) => A.recipes.find((r) => r.id === id);
    const brief = (r) => ({ id: r.id, title: r.title, categories: catsOf(r), servings: r.servings, favorite: !!r.favorite, onList: A.checkedIds.has(r.id) });
    const activeOn = (sid) => {
      if (sid === "mb") return A.allShoppingItems.filter((i) => !A.checkedItems.has(i.key)).map((i) => i.text + (i.manual ? "" : " (for " + i.recipe + ")"));
      if (sid === "target") return A.targetItems.filter((i) => !A.targetChecked.has(i.key)).map((i) => i.text);
      if (sid === "lowes") return A.lowesItems.filter((i) => !A.lowesChecked.has(i.key)).map((i) => i.text);
      const st = A.navStores.find((x) => x.id === sid);
      return st ? st.items.filter((i) => !st.checked.includes(i.key)).map((i) => i.text) : null;
    };
    const cleanList = (a) => (Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : undefined);

    switch (name) {
      case "search_recipes": {
        const q = String(input.query || "").toLowerCase().trim();
        const words = q.split(/\s+/).filter((w) => w.length > 1);
        let list = A.recipes;
        if (input.category) list = list.filter((r) => catsOf(r).includes(input.category));
        if (words.length) list = list.filter((r) => {
          const hay = (r.title + " " + catsOf(r).join(" ") + " " + r.ingredients.join(" ")).toLowerCase();
          return words.some((w) => hay.includes(w));
        });
        return { count: list.length, recipes: list.slice(0, 150).map(brief) };
      }
      case "get_recipe": {
        const r = findR(input.id);
        if (!r) return { error: "No recipe with that id." };
        return { ...brief(r), ingredients: r.ingredients, instructions: r.instructions, notes: r.notes || "", storage: r.storage || "" };
      }
      case "create_recipe": {
        const servings = Math.max(1, parseInt(input.servings) || 4);
        const r = {
          title: String(input.title || "Untitled Recipe").trim(),
          category: CATEGORIES.includes(input.category) ? input.category : "Other",
          categories: catsOf({ category: input.category, categories: input.extra_categories }),
          servings, baseServings: servings,
          ingredients: cleanList(input.ingredients) || [], instructions: cleanList(input.instructions) || [],
          notes: String(input.notes || "").trim(), storage: String(input.storage || "").trim(),
        };
        const [id] = await A.saveRecipesToFirestore([r]);
        return { id, title: r.title, saved: true };
      }
      case "update_recipe": {
        const r = findR(input.id);
        if (!r) return { error: "No recipe with that id." };
        const patch = {};
        if (input.title) patch.title = String(input.title).trim();
        if (CATEGORIES.includes(input.category) || Array.isArray(input.extra_categories)) {
          const main = CATEGORIES.includes(input.category) ? input.category : catsOf(r)[0];
          const extra = Array.isArray(input.extra_categories) ? input.extra_categories : catsOf(r).slice(1);
          patch.categories = catsOf({ category: main, categories: extra });
          patch.category = patch.categories[0];
        }
        if (cleanList(input.ingredients)) patch.ingredients = cleanList(input.ingredients);
        if (cleanList(input.instructions)) patch.instructions = cleanList(input.instructions);
        if (typeof input.notes === "string") patch.notes = input.notes.trim();
        if (typeof input.storage === "string") patch.storage = input.storage.trim();
        if (input.servings) { const v = Math.max(1, parseInt(input.servings) || r.servings); patch.servings = v; if (patch.ingredients) patch.baseServings = v; }
        await updateDoc(doc(db, "recipes", r.id), patch);
        return { id: r.id, updated: Object.keys(patch) };
      }
      case "set_servings": {
        const r = findR(input.id);
        if (!r) return { error: "No recipe with that id." };
        A.setServings(r.id, Math.max(1, parseInt(input.servings) || r.servings));
        return { id: r.id, servings: input.servings };
      }
      case "add_recipe_to_list":
      case "remove_recipe_from_list": {
        const r = findR(input.id);
        if (!r) return { error: "No recipe with that id." };
        const on = name === "add_recipe_to_list";
        A.setRecipeOnList(r.id, on);
        if (!on) return { id: r.id, removed: true };
        const ratio = r.servings / r.baseServings;
        const skipped = r.ingredients
          .map((ing) => toShoppingText(ratio !== 1 ? scaleIngredient(ing, ratio) : ing))
          .filter((t) => isPantryStaple(t, A.pantry));
        return { id: r.id, added: true, servings: r.servings, ingredients: r.ingredients.length, skippedAsPantryStaples: skipped };
      }
      case "add_items": {
        const ids = new Set(A.navStores.map((x) => x.id));
        const items = (input.items || [])
          .filter((i) => i && String(i.name || "").trim())
          .map((i) => ({ name: String(i.name).trim(), qty: Math.max(1, parseInt(i.qty) || 1), store: ids.has(i.store) ? i.store : "mb", section: "" }));
        if (!items.length) return { error: "No items given." };
        A.addEntries(items);
        return { added: items.map((i) => ({ name: i.name, qty: i.qty, store: i.store })) };
      }
      case "get_list": {
        const items = activeOn(input.store);
        if (!items) return { error: "Unknown store id." };
        return { store: input.store, items, ...(input.store === "mb" ? { skippedPantryStaples: A.skippedStaples } : {}) };
      }
      case "get_pantry":
        return { staples: A.pantry };
      case "get_usuals": {
        const onList = new Set((activeOn(input.store) || []).map(usualName));
        return { store: input.store, usuals: usualsFor(A.usuals[input.store], onList).map((u) => ({ name: u.label, usualQty: u.qty, due: u.due, timesBought: u.n })) };
      }
      default:
        return { error: "Unknown tool." };
    }
  };

  const runAgent = async (text) => {
    setAgentBusy(true); setAgentError(null);
    let msgs = [...agentMsgs, { role: "user", content: text }];
    setAgentMsgs(msgs);
    const context = {
      stores: agentRef.current.navStores.map((x) => ({ id: x.id, name: x.label })),
      today: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    };
    try {
      for (let step = 0; step < 14; step++) {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "agent", messages: msgs, context }),
        });
        let data = {};
        try { data = await res.json(); } catch { /* ignore */ }
        if (!res.ok) throw new Error(data.error || "Assistant unavailable (" + res.status + ")");
        msgs = [...msgs, { role: "assistant", content: data.content }];
        setAgentMsgs(msgs);
        const uses = (data.content || []).filter((b) => b.type === "tool_use");
        if (!uses.length) break;
        const results = [];
        for (const u of uses) {
          let out;
          try { out = await runTool(u.name, u.input); } catch (e) { out = { error: e.message || String(e) }; }
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
          await new Promise((r) => setTimeout(r, 120)); // let React re-render so the next tool sees fresh state
        }
        msgs = [...msgs, { role: "user", content: results }];
        setAgentMsgs(msgs);
        if (step === 13) setAgentError("Stopped after a lot of steps — ask it to continue if it wasn't finished.");
      }
    } catch (e) {
      setAgentError(e.message);
      // Drop a dangling tool request so the next message starts cleanly.
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant" && (last.content || []).some((b) => b.type === "tool_use")) msgs = msgs.slice(0, -1);
      setAgentMsgs(msgs);
    }
    setAgentBusy(false);
  };

  const assistantEl = assistantOpen && (
    <AssistantSheet
      messages={agentMsgs}
      busy={agentBusy}
      error={agentError}
      onSend={runAgent}
      onReset={() => { setAgentMsgs([]); setAgentError(null); }}
      onClose={() => setAssistantOpen(false)}
      recipeTitle={recipeTitle}
      storeName={(id) => navStores.find((x) => x.id === id)?.label || id}
    />
  );

  const nav = (
    <>
    {assistantEl}
    <SideNav
      open={navOpen}
      onClose={() => setNavOpen(false)}
      stores={navStores}
      counts={navCounts}
      activeStoreId={storeTab}
      recipesActive={view === "recipes"}
      recipeCount={recipes.length}
      onSelectStore={(id) => { setStoreTab(id); setView("shopping"); setSelectedId(null); }}
      onRecipes={() => { setView("recipes"); setSelectedId(null); setActiveTab("All"); }}
      onAddStore={() => setStoreEditor({ mode: "create" })}
      onAssistant={() => setAssistantOpen(true)}
      onFavorites={() => { setView("recipes"); setSelectedId(null); setActiveTab("Favorites"); }}
      favCount={recipes.filter((r) => r.favorite).length}
      favActive={view === "recipes" && activeTab === "Favorites"}
    />
    </>
  );

  const storeEditorEl = storeEditor && (
    <StoreEditorModal
      store={storeEditor.mode === "edit" ? storeEditor.store : null}
      onClose={() => setStoreEditor(null)}
      onSave={(payload) =>
        storeEditor.mode === "edit" ? updateStore(storeEditor.store.id, payload) : createStore(payload)
      }
      onDelete={() => removeStore(storeEditor.store.id)}
    />
  );

  /* ═════════════════════════════════════════════════════════════════════════
     Screen: loading
     ═════════════════════════════════════════════════════════════════════════ */
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50">
        <div className="animate-fade text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 ring-1 ring-indigo-100">
            <ShoppingCart size={24} className="animate-pulse text-indigo-600" />
          </div>
          <p className="text-[14px] font-medium text-slate-400">Loading {APP_NAME}…</p>
        </div>
      </div>
    );
  }

  /* ═════════════════════════════════════════════════════════════════════════
     Screen: recipe detail
     ═════════════════════════════════════════════════════════════════════════ */
  if (selected) {
    const ratio = selected.servings / selected.baseServings;
    const isEditing = editingRecipeId === selected.id;

    const closeDetail = () => {
      setSelectedId(null); cancelEditRecipe(); setConfirmDelete(false); setAskOpen(false);
      if (wakeLock) wakeLock.release();
      setWakeActive(false); setWakeLock(null);
    };

    return (
      <div className="min-h-dvh bg-slate-50">
        {nav}
        {storeEditorEl}
        {askOpen && (
          <AskRecipeSheet
            recipe={selected}
            onClose={() => setAskOpen(false)}
            onSaveNote={(txt) => updateDoc(doc(db, "recipes", selected.id), {
              notes: (selected.notes ? selected.notes.trim() + "\n\n" : "") + txt.trim(),
            })}
          />
        )}
        <div className="md:pl-64">
          <AppHeader
            title={selected.title}
            subtitle={catsOf(selected).join(" · ")}
            onBack={closeDetail}
            backLabel="Recipes"
            right={
              <div className="flex shrink-0 items-center gap-1.5">
                {!isEditing && !confirmDelete && (
                  <>
                    <IconBtn
                      icon={Sun}
                      size={16}
                      title={wakeActive ? "Let screen sleep" : "Keep screen awake"}
                      onClick={toggleWakeLock}
                      tone={wakeActive ? "bg-amber-50 text-amber-500" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}
                    />
                    <IconBtn icon={Pencil} size={17} title="Edit recipe" onClick={() => startEditRecipe(selected)} />
                    <button
                      type="button"
                      onClick={() => toggleFav(selected.id)}
                      className="grid h-8 w-8 place-items-center rounded-lg transition-all duration-150 hover:bg-slate-100 active:scale-90"
                      title={selected.favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star size={18} className={selected.favorite ? "fill-indigo-600 text-indigo-600" : "text-slate-300"} />
                    </button>
                    <OverflowMenu
                      items={[
                        { icon: Pencil, label: "Edit recipe", onClick: () => startEditRecipe(selected) },
                        { icon: Trash2, label: "Delete recipe", danger: true, onClick: () => setConfirmDelete(true) },
                      ]}
                    />
                  </>
                )}
                {!isEditing && confirmDelete && (
                  <>
                    <button type="button" onClick={() => setConfirmDelete(false)} className={BTN_GHOST}>Cancel</button>
                    <button
                      type="button"
                      onClick={() => deleteRecipe(selected.id)}
                      className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-red-700 active:scale-95"
                    >
                      Delete
                    </button>
                  </>
                )}
                {isEditing && (
                  <>
                    <button type="button" onClick={cancelEditRecipe} className={BTN_GHOST}>Cancel</button>
                    <button type="button" onClick={() => saveEditRecipe(selected.id)} className={BTN_PRIMARY}>Save</button>
                  </>
                )}
              </div>
            }
          />

          <main className="mx-auto max-w-2xl px-4 pb-16 pt-4">
            {isEditing ? (
              <>
                <div className="mb-5">
                  <AiChangeBox
                    getRecipe={() => fromDraft(editDraft)}
                    onApply={(r) => setEditDraft((d) => ({ ...toDraft(r), baseServings: r.servings }))}
                  />
                </div>

                <Field label="Title">
                  <input value={editDraft.title} onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))} className={INPUT} />
                </Field>

                <Field label="Categories" hint="first is the main one · tap to add more">
                  <CategoryPicker value={editDraft.cats} onChange={(cats) => setEditDraft((d) => ({ ...d, cats }))} />
                </Field>

                <Field label="Servings">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setEditDraft((d) => ({ ...d, servings: Math.max(1, (parseInt(d.servings) || 1) - 1) }))}
                      className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-90"
                    >
                      <Minus size={15} />
                    </button>
                    <input
                      type="number" min={1} max={999}
                      value={editDraft.servings}
                      onChange={(e) => setEditDraft((d) => ({ ...d, servings: e.target.value }))}
                      onBlur={() => setEditDraft((d) => ({ ...d, servings: Math.max(1, parseInt(d.servings) || 1) }))}
                      className="w-20 rounded-xl bg-white px-2 py-2 text-center text-[15px] tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setEditDraft((d) => ({ ...d, servings: (parseInt(d.servings) || 1) + 1 }))}
                      className="grid h-9 w-9 place-items-center rounded-full bg-indigo-600 text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-90"
                    >
                      <Plus size={15} />
                    </button>
                    <span className="text-[12px] text-slate-400">Base: {editDraft.baseServings}</span>
                  </div>
                </Field>

                <Field label="Ingredients" hint="(one per line)">
                  <textarea value={editDraft.ingredients} onChange={(e) => setEditDraft((d) => ({ ...d, ingredients: e.target.value }))} className={cx(INPUT, "h-44 resize-y leading-relaxed")} />
                </Field>

                <Field label="Instructions" hint="(one per line)">
                  <textarea value={editDraft.instructions} onChange={(e) => setEditDraft((d) => ({ ...d, instructions: e.target.value }))} className={cx(INPUT, "h-56 resize-y leading-relaxed")} />
                </Field>

                <Field label="Notes">
                  <textarea value={editDraft.notes} onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Personal tweaks, substitutions…" className={cx(INPUT, "h-24 resize-y leading-relaxed")} />
                </Field>

                <Field label="Storage">
                  <textarea value={editDraft.storage} onChange={(e) => setEditDraft((d) => ({ ...d, storage: e.target.value }))} placeholder="e.g. Refrigerate up to 3 days" className={cx(INPUT, "h-20 resize-y leading-relaxed")} />
                </Field>
              </>
            ) : (
              <>
                <div className={cx(CARD, "mb-6 flex items-center gap-3.5 px-4 py-3")}>
                  <button
                    type="button"
                    onClick={() => setServings(selected.id, selected.servings - 1)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 transition-all hover:bg-slate-200 active:scale-90"
                  >
                    <Minus size={15} />
                  </button>
                  <div className="min-w-[44px] text-center">
                    <div className="text-[22px] font-bold leading-none tabular-nums text-slate-900">{selected.servings}</div>
                    <div className="mt-1 text-[10.5px] font-medium uppercase tracking-wide text-slate-400">servings</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setServings(selected.id, selected.servings + 1)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-600 text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-90"
                  >
                    <Plus size={15} />
                  </button>
                  <input
                    type="range" min={1} max={24} step={1}
                    value={Math.min(selected.servings, 24)}
                    onChange={(e) => setServings(selected.id, parseInt(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
                  />
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] font-medium text-slate-400">Found in:</span>
                  {catsOf(selected).map((c, ci) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setActiveTab(c); setSearch(""); setSelectedId(null); }}
                      className={cx("rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 transition-colors",
                        ci === 0 ? "bg-indigo-50 text-indigo-700 ring-indigo-100 hover:bg-indigo-100" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
                      title={"See all " + c}
                    >
                      {c}
                    </button>
                  ))}
                  {selected.favorite && (
                    <button type="button" onClick={() => { setActiveTab("Favorites"); setSearch(""); setSelectedId(null); }}
                      className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-700 ring-1 ring-amber-100">
                      <Star size={11} className="fill-amber-400 text-amber-400" /> Favorites
                    </button>
                  )}
                  <button type="button" onClick={() => startEditRecipe(selected)} className="text-[11.5px] font-medium text-indigo-600 hover:underline">
                    Edit categories
                  </button>
                </div>

                {(() => {
                  const onList = checkedIds.has(selected.id);
                  const r0 = selected.servings / selected.baseServings;
                  const staples = selected.ingredients
                    .map((ing) => toShoppingText(r0 !== 1 ? scaleIngredient(ing, r0) : ing))
                    .filter((t) => isPantryStaple(t, pantry));
                  const n = selected.ingredients.length - staples.length;
                  return (
                    <div className={cx(
                      "mb-3 flex items-center gap-3 rounded-2xl px-4 py-3 ring-1",
                      onList ? "bg-emerald-50 ring-emerald-100" : "bg-white ring-slate-200"
                    )}>
                      <div className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", onList ? "bg-emerald-500 text-white" : "bg-indigo-50 text-indigo-600")}>
                        {onList ? <Check size={17} strokeWidth={3} /> : <ShoppingCart size={17} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold text-slate-900">
                          {onList ? "On your Market Basket list" : "Add to Market Basket list"}
                        </div>
                        <div className="truncate text-[12px] text-slate-500">
                          {n} item{n !== 1 ? "s" : ""} for {selected.servings} servings
                          {staples.length > 0 && " · skipping " + staples.length + " pantry staple" + (staples.length !== 1 ? "s" : "")}
                        </div>
                      </div>
                      {onList ? (
                        <div className="flex shrink-0 gap-1.5">
                          <button type="button" onClick={() => { setView("shopping"); setStoreTab("mb"); setSelectedId(null); }} className={BTN_GHOST}>View list</button>
                          <button type="button" onClick={() => setRecipeOnList(selected.id, false)} className={BTN_GHOST}>Remove</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setRecipeOnList(selected.id, true)} className={cx(BTN_PRIMARY, "flex shrink-0 items-center gap-1")}>
                          <Plus size={14} strokeWidth={2.75} /> Add
                        </button>
                      )}
                    </div>
                  );
                })()}

                <button
                  type="button"
                  onClick={() => setAskOpen(true)}
                  className="mb-6 flex w-full items-center gap-3 rounded-2xl bg-indigo-50/70 px-4 py-3 text-left ring-1 ring-indigo-100 transition-colors hover:bg-indigo-50"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white">
                    <MessageCircle size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-indigo-900">Ask about this recipe</div>
                    <div className="text-[12px] text-indigo-700/70">Swaps, timing, technique — answers know this recipe</div>
                  </div>
                  <ChevronRight size={16} className="text-indigo-300" />
                </button>

                {selected.ingredients.length > 0 && (
                  <section className="mb-6">
                    <h2 className={cx(LABEL_SM, "mb-2 border-b border-slate-200 pb-2 text-indigo-500")}>Ingredients</h2>
                    <IngredientChecklist
                      recipeId={selected.id}
                      items={selected.ingredients.map((ing) => (ratio !== 1 ? scaleIngredient(ing, ratio) : ing))}
                    />
                  </section>
                )}

                {selected.instructions.length > 0 && (
                  <section className="mb-6">
                    <h2 className={cx(LABEL_SM, "mb-2 border-b border-slate-200 pb-2 text-indigo-500")}>Instructions</h2>
                    <ol>
                      {selected.instructions.map((step, i) => {
                        const secs = extractTimerSeconds(step);
                        return (
                          <li key={i} className="flex gap-3 border-b border-slate-100 py-3 last:border-0">
                            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[14.5px] leading-relaxed text-slate-700">{step}</p>
                              {secs && <StepTimer id={selected.id + "-" + i} seconds={secs} label={selected.title} stepText={step} recipeId={selected.id} />}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                )}

                {selected.storage && (
                  <section className="mb-6">
                    <h2 className={cx(LABEL_SM, "mb-2 border-b border-slate-200 pb-2 text-indigo-500")}>Storage</h2>
                    <p className="rounded-xl bg-white p-3.5 text-[14.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200">{selected.storage}</p>
                  </section>
                )}

                {selected.notes && (
                  <section className="mb-6">
                    <h2 className={cx(LABEL_SM, "mb-2 border-b border-slate-200 pb-2 text-indigo-500")}>Notes</h2>
                    <p className="whitespace-pre-line rounded-xl bg-white p-3.5 text-[14.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200">{selected.notes}</p>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    );
  }

  /* ═════════════════════════════════════════════════════════════════════════
     Screen: recipes (with Import folded in)
     ═════════════════════════════════════════════════════════════════════════ */
  if (view === "recipes") {
    return (
      <div className="min-h-dvh bg-slate-50">
        {nav}
        {storeEditorEl}

        {importOpen && <ImportSheet onClose={() => setImportOpen(false)} onSave={handleImportSave} />}
        {ideasOpen && (
          <IdeasSheet
            existingTitles={recipes.map((r) => r.title)}
            onAdd={async (r) => (await saveRecipesToFirestore([r]))[0]}
            onOpen={(id) => { setIdeasOpen(false); setSelectedId(id); }}
            onClose={() => setIdeasOpen(false)}
          />
        )}

        <div className="md:pl-64">
          <AppHeader
            title="Recipes"
            subtitle={recipes.length + (recipes.length === 1 ? " recipe" : " recipes")}
            onMenu={() => setNavOpen(true)}
            right={
              <div className="flex shrink-0 items-center gap-1.5">
                <IconBtn icon={ArrowUpDown} size={15} title={sortAZ ? "Sort Z→A" : "Sort A→Z"} onClick={() => setSortAZ((v) => !v)} />
                <IconBtn icon={Sparkles} size={16} title="Assistant" onClick={() => setAssistantOpen(true)} tone="text-indigo-600 hover:bg-indigo-50" />
                <button
                  type="button"
                  onClick={() => setIdeasOpen(true)}
                  className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-indigo-700 ring-1 ring-indigo-200 transition-all duration-150 hover:bg-indigo-50 active:scale-95"
                >
                  <Lightbulb size={14} strokeWidth={2.5} />
                  Ideas
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-indigo-700 hover:shadow-md active:scale-95"
                >
                  <Download size={14} strokeWidth={2.5} />
                  Import
                </button>
              </div>
            }
          >
            <div className="relative px-4 pb-2">
              <Search size={15} className="pointer-events-none absolute left-7 top-[calc(50%-4px)] -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearch("")}
                placeholder="Search all recipes — name, ingredient, category…"
                className="w-full rounded-full bg-slate-100 py-2.5 pl-10 pr-9 text-[14.5px] text-slate-900 ring-1 ring-transparent transition-shadow duration-150 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-6 top-[calc(50%-4px)] grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {!searchWords.length && (
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2.5">
              {CATEGORIES.map((cat) => {
                const on = activeTab === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveTab(cat)}
                    className={cx(
                      "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] transition-all duration-200 active:scale-95",
                      on ? "bg-indigo-600 font-semibold text-white shadow-sm"
                        : "bg-white font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    {cat === "Favorites" ? (
                      <span className="flex items-center gap-1">
                        <Star size={12} className={on ? "fill-white text-white" : "fill-amber-400 text-amber-400"} />
                        Favorites
                        <span className={cx("tabular-nums", on ? "text-indigo-100" : "text-slate-400")}>{favCount}</span>
                      </span>
                    ) : cat}
                  </button>
                );
              })}
            </div>
            )}
          </AppHeader>

          <main className="mx-auto max-w-2xl px-4 pb-16 pt-3">

            {searchWords.length > 0 && (
              <p className="mb-2 px-1 text-[12.5px] text-slate-500">
                {filtered.length} recipe{filtered.length !== 1 ? "s" : ""} match “{search.trim()}” across all categories
              </p>
            )}
            {searchWords.length > 0 && filtered.length === 0 ? (
              <div className="mt-6 text-center">
                <p className="text-[14px] font-semibold text-slate-700">Nothing saved matches “{search.trim()}”.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => { setIdeasOpen(true); }} className={cx(BTN_PRIMARY, "flex items-center gap-1.5")}>
                    <Lightbulb size={14} /> Get a recipe for it
                  </button>
                  <button type="button" onClick={() => { setAssistantOpen(true); runAgent("Find recipes for: " + search.trim() + " — check my saved recipes for close matches first."); }} className={cx(BTN_GHOST, "flex items-center gap-1.5")}>
                    <Sparkles size={14} /> Ask the assistant
                  </button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={search ? "No recipes match your search." : activeTab === "Favorites" ? "No favorites yet." : "No recipes in this category yet."}
                hint={search ? "Try a different ingredient or title." : activeTab === "Favorites" ? "Open a recipe and tap the ☆ at the top to star it." : "Use the Import button to add one."}
              />
            ) : (
              filtered.map((r) => {
                const on = checkedIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={cx(CARD, "group mb-2 flex items-center gap-3 px-3.5 py-3 hover:shadow-md", on ? "ring-2 ring-indigo-500" : "hover:ring-slate-300")}
                  >
                    <Checkbox checked={on} shape="square" onChange={(e) => toggleCheck(r.id, e)} label={"Add " + r.title + " to Market Basket"} />
                    <button type="button" onClick={() => setSelectedId(r.id)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-[15px] font-semibold text-slate-900 transition-colors group-hover:text-indigo-600">{r.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {catsOf(r).map((c, ci) => (
                          <span key={c} className={cx("rounded-full px-2 py-px text-[10.5px] font-semibold",
                            ci === 0 ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500")}>{c}</span>
                        ))}
                        <span className="text-[11.5px] text-slate-400">· {r.servings} servings</span>
                      </div>
                      {r._hit && <p className="mt-1 truncate text-[11.5px] text-slate-500">has: {r._hit}</p>}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => toggleFav(r.id, e)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-all duration-150 hover:bg-slate-100 active:scale-90"
                      title={r.favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star size={17} className={r.favorite ? "fill-indigo-600 text-indigo-600" : "text-slate-300 hover:text-slate-400"} />
                    </button>
                  </div>
                );
              })
            )}
          </main>
        </div>
      </div>
    );
  }

  /* ═════════════════════════════════════════════════════════════════════════
     Screen: shopping list
     ═════════════════════════════════════════════════════════════════════════ */
  const store = navStores.find((s) => s.id === storeTab) || BUILTIN_STORES[0];
  const isCustom = !store.builtIn;

  const targetGrouped = {};
  TARGET_CATEGORIES.forEach((c) => { targetGrouped[c.key] = []; });
  targetItems.forEach((item) => { (targetGrouped[item.category] || targetGrouped["other"]).push(item); });
  const targetActiveCats = TARGET_CATEGORIES.filter((c) => targetGrouped[c.key]?.length > 0);
  const targetTotal = targetItems.length;
  const targetCC = targetItems.filter((i) => targetChecked.has(i.key)).length;

  const lowesGrouped = {};
  LOWES_CATEGORIES.forEach((c) => { lowesGrouped[c.key] = []; });
  lowesItems.forEach((item) => { (lowesGrouped[item.category] || lowesGrouped["other"]).push(item); });
  const lowesActiveCats = LOWES_CATEGORIES.filter((c) => lowesGrouped[c.key]?.length > 0);
  const lowesTotal = lowesItems.length;
  const lowesCC = lowesItems.filter((i) => lowesChecked.has(i.key)).length;

  /* Custom store grouping: declared sections in order, then Unsorted. */
  const customDone = isCustom ? new Set(store.checked) : null;
  const customBuckets = isCustom
    ? [
      ...store.sections.map((s) => ({
        key: s.key,
        label: s.label,
        rows: store.items.filter((i) => i.sectionKey === s.key),
      })),
      {
        key: "__unsorted",
        label: "Unsorted",
        rows: store.items.filter(
          (i) => !i.sectionKey || !store.sections.some((s) => s.key === i.sectionKey)
        ),
      },
    ].filter((b) => b.rows.length > 0)
    : [];
  const customTotal = isCustom ? store.items.length : 0;
  const customCC = isCustom ? store.items.filter((i) => customDone.has(i.key)).length : 0;

  const cTotal = isCustom ? customTotal : storeTab === "mb" ? listTotal : storeTab === "target" ? targetTotal : lowesTotal;
  const cChecked = isCustom ? customCC : storeTab === "mb" ? checked : storeTab === "target" ? targetCC : lowesCC;
  const cPct = cTotal > 0 ? Math.round((cChecked / cTotal) * 100) : 0;

  const addFn = isCustom
    ? () => addCustomItem(store)
    : storeTab === "mb" ? addManual : storeTab === "target" ? addTargetItem : addLowesItem;
  const inputVal = isCustom
    ? customInput[store.id] || ""
    : storeTab === "mb" ? manualInput : storeTab === "target" ? targetInput : lowesInput;
  const setInputVal = isCustom
    ? (v) => setCustomInput((p) => ({ ...p, [store.id]: v }))
    : storeTab === "mb" ? setManualInput : storeTab === "target" ? setTargetInput : setLowesInput;
  const qtyVal = isCustom
    ? customQty[store.id] || ""
    : storeTab === "mb" ? manualQty : storeTab === "target" ? targetQty : lowesQty;
  const setQtyVal = isCustom
    ? (v) => setCustomQty((p) => ({ ...p, [store.id]: v }))
    : storeTab === "mb" ? setManualQty : storeTab === "target" ? setTargetQty : setLowesQty;

  /** A single typed item: add it straight away (the AI only steps in to place it if needed). */
  const plainAdd = () => {
    const name = inputVal.trim();
    if (!name) return;
    addEntries([{ name, qty: parseInt(qtyVal) || 1, store: store.id, section: "" }]);
    setInputVal(""); setQtyVal("");
  };

  /* What's on this store's list right now (so usuals don't suggest it). */
  const onListNames = new Set(
    (isCustom
      ? store.items.filter((i) => !store.checked.includes(i.key))
      : storeTab === "mb" ? allShoppingItems.filter((i) => !checkedItems.has(i.key))
        : storeTab === "target" ? targetItems.filter((i) => !targetChecked.has(i.key))
          : lowesItems.filter((i) => !lowesChecked.has(i.key))
    ).map((i) => usualName(i.text))
  );
  const storeUsuals = usualsFor(usuals[store.id], onListNames);
  const dueUsuals = storeUsuals.filter((u) => u.due);
  const resetFn = isCustom
    ? () => resetCustomStore(store)
    : storeTab === "mb" ? resetShopping : storeTab === "target" ? resetTarget : resetLowes;
  const countdown = storeTab === "target" ? targetCountdown : storeTab === "lowes" ? lowesCountdown : null;

  const menuItems = [
    {
      icon: RotateCcw,
      label: confirmReset ? "Tap again to confirm" : "Reset " + store.short + " list",
      danger: true,
      onClick: () => {
        if (confirmReset) { resetFn(); setConfirmReset(false); }
        else { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); }
      },
    },
    isCustom && {
      icon: Pencil,
      label: "Edit store & sections",
      onClick: () => setStoreEditor({ mode: "edit", store }),
    },
    storeTab === "mb" && {
      icon: MapPin,
      label: "Saved aisle settings",
      hint: Object.keys(aisleRules).length ? String(Object.keys(aisleRules).length) : undefined,
      onClick: () => setRulesOpen(true),
    },
    storeTab === "mb" && {
      icon: Archive,
      label: "Pantry staples",
      hint: pantry.length ? String(pantry.length) : undefined,
      onClick: () => setPantryOpen(true),
    },
    {
      icon: Repeat,
      label: "Usuals",
      hint: dueUsuals.length ? dueUsuals.length + " due" : undefined,
      onClick: () => setUsualsOpen(true),
    },
    {
      icon: Sun,
      label: wakeActive ? "Let screen sleep" : "Keep screen awake",
      onClick: toggleWakeLock,
    },
  ];

  return (
    <div className="min-h-dvh bg-slate-50">
      {nav}
      {storeEditorEl}

      {aisleEditorItem && (
        <AisleEditorModal
          item={aisleEditorItem}
          onSelect={handleAisleSelect}
          onManage={() => { setAisleEditorItem(null); setRulesOpen(true); }}
          onClose={() => setAisleEditorItem(null)}
        />
      )}

      {pantryOpen && <PantryModal pantry={pantry} onSave={savePantry} onClose={() => setPantryOpen(false)} />}
      {rulesOpen && (
        <AisleRulesModal rules={aisleRules} onDelete={deleteAisleRule} onClose={() => setRulesOpen(false)} />
      )}

      {sectionPicker && isCustom && (
        <SectionPickerModal
          item={sectionPicker}
          store={store}
          onSelect={(key) => setCustomItemSection(store, sectionPicker.key, key)}
          onManage={() => { setSectionPicker(null); setStoreEditor({ mode: "edit", store }); }}
          onClose={() => setSectionPicker(null)}
        />
      )}

      <div className="md:pl-64">
        <AppHeader
          title={store.label}
          subtitle="Shopping list"
          onMenu={() => setNavOpen(true)}
          right={
            <div className="flex items-center gap-0.5">
              <IconBtn icon={Sparkles} size={17} title="Assistant" onClick={() => setAssistantOpen(true)} tone="text-indigo-600 hover:bg-indigo-50" />
              <OverflowMenu items={menuItems} />
            </div>
          }
        >
          <div className="px-4 pb-2.5">
            <ProgressRail
              pct={cPct}
              done={cTotal > 0 && cChecked === cTotal}
              checkedCount={cChecked}
              total={cTotal}
              barClass={store.bar}
              note={countdown}
            />
          </div>
        </AppHeader>

        <main className="mx-auto max-w-2xl px-4 pb-float pt-2">
          {storesError && (
            <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800 ring-1 ring-amber-200">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span>
                Custom stores can't be read or written ({storesError}). Your Firestore rules probably
                don't cover the <code className="font-mono">stores</code> collection yet.
              </span>
            </div>
          )}

          {dueUsuals.length > 0 && (
            <button
              type="button"
              onClick={() => setUsualsOpen(true)}
              className="mb-3 flex w-full items-center gap-2.5 rounded-xl bg-indigo-50 px-3 py-2.5 text-left text-[13px] text-indigo-900 ring-1 ring-indigo-100"
            >
              <Repeat size={15} className="shrink-0 text-indigo-600" />
              <span className="min-w-0 flex-1 truncate">
                <b>{dueUsuals.length} usual{dueUsuals.length !== 1 ? "s" : ""} due:</b> {dueUsuals.map((u) => u.label).join(", ")}
              </span>
              <span className="shrink-0 font-semibold text-indigo-600">Review</span>
            </button>
          )}

          {/* ── Market Basket ── */}
          {storeTab === "mb" && (
            <>
              {checkedIds.size > 0 && (
                <p className="mb-2 line-clamp-2 text-[12px] italic text-slate-400">
                  From: {recipes.filter((r) => checkedIds.has(r.id)).map((r) => r.title).join(", ")}
                </p>
              )}
              {skippedStaples.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPantryOpen(true)}
                  className="mb-3 flex w-full items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-[12.5px] text-amber-800 ring-1 ring-amber-100"
                >
                  <Archive size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    Skipped pantry staples: {skippedStaples.join(", ")}
                  </span>
                  <span className="shrink-0 font-semibold">Edit</span>
                </button>
              )}

              {total === 0 && (
                <EmptyState icon={ShoppingCart} title="Nothing on the list yet" hint="Check off recipes, or add an item below." />
              )}

              {total > 0 && (
                <>
                  {activeSections.map((sec) => {
                    const Icon = SECTION_ICONS[sec.key] || Package;
                    const rows = grouped[sec.key].filter((item) => !checkedItems.has(item.key));
                    return (
                      <section key={sec.key} className="mb-4">
                        <SectionHeader icon={Icon} label={stripEmoji(sec.label)} count={rows.length} />
                        <div className="pt-2">
                          {rows.map((item) => (
                            <MBItem
                              key={item.key}
                              item={item}
                              sec={sec}
                              isEd={editingKey === item.key}
                              editingText={editingText}
                              setEditingText={setEditingText}
                              editingQty={editingQty}
                              setEditingQty={setEditingQty}
                              onToggle={() => toggleKeys(item.keys || [item.key])}
                              onEdit={startEdit}
                              onSaveEdit={saveEdit}
                              onCancelEdit={() => setEditingKey(null)}
                              onRemove={() => removeKeys(item.keys || [item.key])}
                              onAislePick={handleAislePick}
                              onPantry={markPantry}
                              recipes={recipes}
                              setSelectedId={setSelectedId}
                              setView={setView}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}

                  {completedItems.length > 0 && (
                    <section className="mb-4">
                      <SectionHeader icon={Check} label="Completed" count={completedItems.length} tone="text-emerald-500" />
                      <div className="pt-2">
                        {completedItems.map((item) => (
                          <CompletedItem
                            key={item.key}
                            item={item}
                            sec={STORE_SECTIONS.find((s) => s.key === item.sectionKey)}
                            onToggle={toggleItem}
                            onRemove={removeItem}
                            onSaveQty={saveCompletedQty}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Target ── */}
          {storeTab === "target" && targetTotal === 0 && (
            <EmptyState icon={TargetIcon} title="Nothing on the Target list" hint="Add an item below to get started." />
          )}
          {storeTab === "target" && targetActiveCats.map((cat) => {
            const Icon = TARGET_ICONS[cat.key] || Package;
            return (
              <section key={cat.key} className="mb-4">
                <SectionHeader icon={Icon} label={stripEmoji(cat.label)} count={targetGrouped[cat.key].length} tone="text-red-500" />
                <div className="pt-2">
                  {targetGrouped[cat.key].map((item) => (
                    <GenericItem key={item.key} item={item} store={store} done={targetChecked.has(item.key)} onToggle={toggleTargetItem} onRemove={removeTargetItem} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* ── Lowe's ── */}
          {storeTab === "lowes" && lowesTotal === 0 && (
            <EmptyState icon={Hammer} title="Nothing on the Lowe's list" hint="Add an item below to get started." />
          )}
          {storeTab === "lowes" && lowesActiveCats.map((cat) => {
            const Icon = LOWES_ICONS[cat.key] || Package;
            return (
              <section key={cat.key} className="mb-4">
                <SectionHeader icon={Icon} label={stripEmoji(cat.label)} count={lowesGrouped[cat.key].length} tone="text-blue-500" />
                <div className="pt-2">
                  {lowesGrouped[cat.key].map((item) => (
                    <GenericItem key={item.key} item={item} store={store} done={lowesChecked.has(item.key)} onToggle={toggleLowesItem} onRemove={removeLowesItem} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* ── Custom store ── */}
          {isCustom && customTotal === 0 && (
            <EmptyState
              icon={store.icon}
              title={"Nothing on the " + store.label + " list"}
              hint={
                store.sections.length
                  ? "Add an item below, then tap its badge to file it under a section."
                  : "Add an item below. Add sections from the ⋮ menu when you want them grouped."
              }
            />
          )}
          {isCustom && customBuckets.map((bucket) => (
            <section key={bucket.key} className="mb-4">
              <SectionHeader
                icon={bucket.key === "__unsorted" ? Package : store.icon}
                label={bucket.label}
                count={bucket.rows.length}
                tone={bucket.key === "__unsorted" ? "text-slate-400" : store.text}
              />
              <div className="pt-2">
                {bucket.rows.map((item) => (
                  <CustomItem
                    key={item.key}
                    item={item}
                    store={store}
                    done={customDone.has(item.key)}
                    sectionLabel={store.sections.find((s) => s.key === item.sectionKey)?.label || null}
                    onToggle={(k) => toggleCustomItem(store, k)}
                    onRemove={(k) => removeCustomItem(store, k)}
                    onPickSection={(it) => setSectionPicker(it)}
                  />
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>

      {usualsOpen && (
        <UsualsSheet
          storeName={store.label}
          usuals={storeUsuals}
          onForget={(name) => forgetUsual(store.id, name)}
          onAdd={(list) => {
            addEntries(list.map((u) => ({ name: u.label, qty: u.qty, store: store.id, section: u.section })));
            showToast("Added " + list.length + " usual" + (list.length !== 1 ? "s" : "") + " to " + store.label);
          }}
          onClose={() => setUsualsOpen(false)}
        />
      )}

      <AddItemBar
        qty={qtyVal} setQty={setQtyVal} value={inputVal} setValue={setInputVal}
        onAdd={plainAdd}
        onSmartAdd={(t) => smartAdd(t, () => { setInputVal(""); setQtyVal(""); })}
        smartBusy={smartBusy}
        toast={listToast}
        store={store}
        storeNames={[...navStores.map((x) => x.label), "lowes", "target", "market basket"]}
      />
    </div>
  );
}
