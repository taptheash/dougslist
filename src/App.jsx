import { useState, useMemo, useEffect, useRef } from "react";
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
  toShoppingText, combineItems,
  produceSubSort
} from "./config.js";
import {
  ShoppingCart, Target as TargetIcon, Hammer, Wheat, Carrot, Beef, Sandwich, Snowflake, Pizza, Wine,
  Cookie, Droplet, CupSoda, Popcorn, Sparkles, PawPrint, SprayCan, Pill, Utensils, Coffee, Package,
  Soup, Milk, Salad, Egg, Fish, Shirt, Home as HomeIcon, Zap, Gamepad2, Layers, Wrench, DoorOpen,
  Paintbrush, Leaf, TreePine, Wind, X, Pencil, Check, Sun, Star, FileText, Camera, Link2,
  AlertTriangle, ChevronLeft, ChevronRight, Search, ArrowUpDown, BookOpen, Download,
  MoreVertical, RotateCcw, Plus, Minus, Menu, Store, ShoppingBag, Trash2, MapPin
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   1. Utilities and design constants
   ═══════════════════════════════════════════════════════════════════════════ */

/** Join conditional class names. Falsy entries are dropped. */
const cx = (...parts) => parts.filter(Boolean).join(" ");

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
function SideNav({ open, onClose, stores, counts, activeStoreId, onSelectStore, onAddStore, onRecipes, recipesActive, recipeCount }) {
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

          <button type="button" onClick={() => { onRecipes(); onClose(); }} className={row(recipesActive)}>
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
        </nav>
      </aside>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Shopping-list components
   ═══════════════════════════════════════════════════════════════════════════ */

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
        setRemaining((r) => {
          if (r <= 1) {
            clearInterval(ref.current);
            setRunning(false);
            setDone(true);
            try { sendNotif("Timer done!", stepText?.slice(0, 60)); } catch (e) { /* ignore */ }
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      clearInterval(ref.current);
    }
    return () => clearInterval(ref.current);
  }, [running]);

  const pct = Math.round(((seconds - remaining) / seconds) * 100);
  const circ = 2 * Math.PI * 9;
  const reset = (e) => { e.stopPropagation(); setRemaining(seconds); setRunning(false); setDone(false); };

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (done) reset(e); else setRunning((r) => !r); }}
      className={cx(
        "mt-2 inline-flex items-center gap-2 rounded-full py-1 pl-1.5 pr-3 ring-1 transition-all duration-200 active:scale-95",
        done ? "bg-emerald-50 text-emerald-600 ring-emerald-200"
          : running ? "bg-indigo-50 text-indigo-600 ring-indigo-200"
            : "bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200"
      )}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0">
        <circle cx="11" cy="11" r="9" fill="none" strokeWidth="2.5" className="stroke-slate-300/70" />
        {!done && (
          <circle
            cx="11" cy="11" r="9" fill="none" strokeWidth="2.5" strokeLinecap="round"
            className={running ? "stroke-indigo-500" : "stroke-slate-400"}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct / 100)}
            transform="rotate(-90 11 11)"
            style={{ transition: "stroke-dashoffset 0.9s linear" }}
          />
        )}
        <text x="11" y="15" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor">
          {done ? "✓" : running ? "▐▐" : "▶"}
        </text>
      </svg>
      <span className="min-w-[38px] text-center text-[13px] font-semibold tabular-nums">
        {done ? "Done!" : fmtTime(remaining)}
      </span>
      {(running || done) && <RotateCcw size={11} className="opacity-60" onClick={reset} />}
    </button>
  );
}

function MBItem({
  item, sec, isEd, editingText, setEditingText, editingQty, setEditingQty,
  onToggle, onEdit, onSaveEdit, onCancelEdit, onRemove, onAislePick,
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
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} max={99} autoFocus
              value={editingQty}
              onChange={(e) => setEditingQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(item.key); if (e.key === "Escape") onCancelEdit(); }}
              className="w-14 rounded-lg px-2 py-1.5 text-center text-[14px] tabular-nums ring-2 ring-indigo-500 focus:outline-none"
            />
            <input
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(item.key); if (e.key === "Escape") onCancelEdit(); }}
              onBlur={() => onSaveEdit(item.key)}
              placeholder="item name"
              className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[14px] ring-2 ring-indigo-500 focus:outline-none"
            />
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

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <IconBtn icon={Pencil} size={13} title="Edit item" onClick={(e) => onEdit(item.key, item.text, e)} />
        <IconBtn icon={X} size={14} title="Remove item" onClick={() => onRemove(item.key)} tone="text-slate-400 hover:bg-red-50 hover:text-red-600" />
      </div>

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
function AddItemBar({ qty, setQty, value, setValue, onAdd, store }) {
  const inputRef = useRef(null);

  const commit = () => {
    if (!value.trim()) return;
    onAdd();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="fixed inset-x-0 float-bottom z-30 px-3 md:pl-[17rem] md:pr-4">
      <div className="mx-auto flex max-w-lg items-center rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-slate-200 backdrop-blur-xl transition-shadow duration-200 focus-within:shadow-xl focus-within:ring-2 focus-within:ring-indigo-500">
        <input
          type="number" min={1} max={99}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); inputRef.current?.focus(); } }}
          placeholder="1"
          aria-label="Quantity"
          className="w-12 shrink-0 bg-transparent py-2 text-center text-[15px] tabular-nums text-slate-700 placeholder:text-slate-300 focus:outline-none"
        />
        <span className="h-5 w-px shrink-0 bg-slate-200" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          placeholder={"Add to " + store.short + "…"}
          aria-label="Item name"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          disabled={!value.trim()}
          className={cx(
            "flex shrink-0 items-center gap-1 rounded-full px-3.5 py-2 text-[13px] font-semibold text-white",
            "transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100",
            store.solid
          )}
        >
          <Plus size={15} strokeWidth={2.75} />
          Add
        </button>
      </div>
    </div>
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
   8. App
   ═══════════════════════════════════════════════════════════════════════════ */

export default function App() {
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

  const [importOpen, setImportOpen] = useState(false);
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
        if (data.aisleRules) setAisleRules(data.aisleRules);
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
  const allShoppingItems = useMemo(() => {
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

  const grouped = useMemo(() => {
    const g = {};
    STORE_SECTIONS.forEach((s) => { g[s.key] = []; });
    allShoppingItems.forEach((item) => { (g[item.sectionKey] || g["kitchen"]).push(item); });
    const c = {};
    Object.keys(g).forEach((k) => {
      let items = combineItems(g[k]);
      c[k] = k === "produce" ? produceSubSort(items) : items;
    });
    return c;
  }, [allShoppingItems]);

  const total = allShoppingItems.length;
  const checked = allShoppingItems.filter((i) => checkedItems.has(i.key)).length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  const activeSections = STORE_SECTIONS.filter((s) => grouped[s.key]?.some((i) => !checkedItems.has(i.key)));
  const completedItems = allShoppingItems.filter((i) => checkedItems.has(i.key));

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
    setDoc(doc(db, "app", "mbSettings"), { aisleRules: next }, { merge: true });
  };

  /* ── Market Basket mutations ───────────────────────────────────────────── */
  const resetShopping = () => {
    const e = { checkedIds: [], checkedItems: [], manualItems: [], removedKeys: [], resetAt: null };
    setCheckedIds(new Set()); setCheckedItems(new Set()); setManualItems([]);
    setRemovedKeys(new Set()); setEditingKey(null); saveShop(e);
  };

  const toggleCheck = (id, e) => {
    e.stopPropagation();
    setCheckedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); saveShop({ checkedIds: [...n] }); return n; });
  };

  const toggleItem = (key) => {
    setCheckedItems((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); saveShop({ checkedItems: [...n] }); return n; });
  };

  const removeItem = (key) => {
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

  const saveEdit = (key) => {
    if (!editingText.trim()) { setEditingKey(null); return; }
    const qty = parseInt(editingQty) || 1;
    const finalText = qty > 1 ? qty + " " + editingText.trim() : editingText.trim();
    const u = manualItems.map((m) => (m.key === key ? { ...m, text: finalText } : m));
    setManualItems(u); saveShop({ manualItems: u }); setEditingKey(null); setEditingQty("");
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

  const saveRecipesToFirestore = async (nr) => {
    const batch = writeBatch(db);
    nr.forEach((r, i) => {
      const id = "recipe_" + Date.now() + "_" + i;
      batch.set(doc(db, "recipes", id), {
        title: r.title, category: r.category, baseServings: r.baseServings, servings: r.servings,
        ingredients: r.ingredients, instructions: r.instructions, favorite: false, notes: "", storage: "",
      });
    });
    await batch.commit();
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    const nr = parseRecipes(importText);
    if (nr.length) { await saveRecipesToFirestore(nr); setImportText(""); setShowImport(false); setImportOpen(false); }
  };

  const handlePhotoImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoImporting(true); setPhotoError(null); setShowPhotoImport(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Failed to read file"));
        r.readAsDataURL(file);
      });
      const mediaType = file.type || "image/jpeg";
      const response = await fetch("/api/import-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mediaType }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "API error: " + response.status);
      const recipeText = data.recipeText;
      if (!recipeText) throw new Error("No recipe text returned");
      const nr = parseRecipes(recipeText);
      if (!nr.length) throw new Error("Could not parse recipe from image");
      await saveRecipesToFirestore(nr);
      setShowPhotoImport(false); setPhotoImporting(false); setImportOpen(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    } catch (err) {
      setPhotoError(err.message || "Something went wrong.");
      setPhotoImporting(false);
    }
  };

  const handleUrlImport = async () => {
    if (!urlImportValue.trim()) return;
    setUrlImporting(true); setUrlImportError(null);
    try {
      const response = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlImportValue.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "API error: " + response.status);
      const recipeText = data.recipeText;
      if (!recipeText) throw new Error("No recipe text returned");
      const nr = parseRecipes(recipeText);
      if (!nr.length) throw new Error("Could not parse a recipe from that URL. Try the text import instead.");
      await saveRecipesToFirestore(nr);
      setShowUrlImport(false); setUrlImportValue(""); setUrlImporting(false); setImportOpen(false);
    } catch (err) {
      setUrlImportError(err.message || "Something went wrong.");
      setUrlImporting(false);
    }
  };

  const startEditRecipe = (r) => {
    setEditDraft({
      title: r.title, category: r.category, servings: r.servings, baseServings: r.baseServings,
      ingredients: r.ingredients.join("\n"), instructions: r.instructions.join("\n"),
      notes: r.notes || "", storage: r.storage || "",
    });
    setEditingRecipeId(r.id);
  };

  const saveEditRecipe = async (id) => {
    await updateDoc(doc(db, "recipes", id), {
      title: editDraft.title.trim(),
      category: editDraft.category,
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

  const filtered = useMemo(() => {
    let list = recipes;
    if (activeTab === "Favorites") list = list.filter((r) => r.favorite);
    else if (activeTab !== "All") list = list.filter((r) => r.category === activeTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => (sortAZ ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title)));
  }, [recipes, activeTab, search, sortAZ]);

  const selected = recipes.find((r) => r.id === selectedId);

  /* ── Shared chrome ─────────────────────────────────────────────────────── */
  const nav = (
    <SideNav
      open={navOpen}
      onClose={() => setNavOpen(false)}
      stores={navStores}
      counts={navCounts}
      activeStoreId={storeTab}
      recipesActive={view === "recipes"}
      recipeCount={recipes.length}
      onSelectStore={(id) => { setStoreTab(id); setView("shopping"); setSelectedId(null); }}
      onRecipes={() => { setView("recipes"); setSelectedId(null); }}
      onAddStore={() => setStoreEditor({ mode: "create" })}
    />
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
      setSelectedId(null); cancelEditRecipe(); setConfirmDelete(false);
      if (wakeLock) wakeLock.release();
      setWakeActive(false); setWakeLock(null);
    };

    return (
      <div className="min-h-dvh bg-slate-50">
        {nav}
        {storeEditorEl}
        <div className="md:pl-64">
          <AppHeader
            title={selected.title}
            subtitle={selected.category}
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
                <Field label="Title">
                  <input value={editDraft.title} onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))} className={INPUT} />
                </Field>

                <Field label="Category">
                  <select value={editDraft.category} onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))} className={INPUT}>
                    {CATEGORIES.filter((c) => c !== "All" && c !== "Favorites").map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
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

                {selected.ingredients.length > 0 && (
                  <section className="mb-6">
                    <h2 className={cx(LABEL_SM, "mb-2 border-b border-slate-200 pb-2 text-indigo-500")}>Ingredients</h2>
                    <ul>
                      {selected.ingredients.map((ing, i) => (
                        <li key={i} className="border-b border-slate-100 py-2 text-[14.5px] text-slate-700 last:border-0">
                          {ratio !== 1 ? scaleIngredient(ing, ratio) : ing}
                        </li>
                      ))}
                    </ul>
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
                              {secs && <StepTimer key={selected.id + "-" + i} seconds={secs} stepText={step} />}
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
                    <p className="rounded-xl bg-white p-3.5 text-[14.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200">{selected.notes}</p>
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

        {importOpen && (
          <Sheet title="Import a recipe" subtitle="Paste it, shoot it, or link it" onClose={() => setImportOpen(false)} wide>
            <div className="flex flex-col gap-2.5">
              {/* Paste text */}
              <div className={cx(CARD, "overflow-hidden")}>
                <button
                  type="button"
                  onClick={() => setShowImport((v) => !v)}
                  className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50">
                    <FileText size={18} className="text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-semibold text-slate-900">Paste text</div>
                    <div className="mt-0.5 text-[12px] text-slate-400">Copy &amp; paste from anywhere</div>
                  </div>
                  <ChevronRight size={16} className={cx("shrink-0 text-slate-300 transition-transform duration-200", showImport && "rotate-90")} />
                </button>
                {showImport && (
                  <div className="animate-rise px-4 pb-4">
                    <textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder={"Recipe Title\nCategory: Mains\nServings: 4\nIngredients:\n- ingredient\nInstructions:\n1. Step one"}
                      className="h-40 w-full resize-y rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-900 ring-1 ring-slate-200 transition-shadow placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <button type="button" onClick={() => { setShowImport(false); setImportText(""); }} className={BTN_GHOST}>Clear</button>
                      <button type="button" onClick={handleImport} className={BTN_PRIMARY}>Save recipe</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Photo (mobile only) */}
              {isMobile && (
                <>
                  <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoImport} className="hidden" />
                  <div className={cx(CARD, "overflow-hidden")}>
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-slate-50"
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50">
                        <Camera size={18} className="text-indigo-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[14.5px] font-semibold text-slate-900">Photo</div>
                        <div className="mt-0.5 text-[12px] text-slate-400">Shoot a page or a screenshot</div>
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-slate-300" />
                    </button>
                    {showPhotoImport && (
                      <div className="animate-rise px-4 pb-4 text-center">
                        {photoImporting ? (
                          <>
                            <p className="text-[13px] font-medium text-slate-500">Reading recipe from photo…</p>
                            <p className="mt-1 text-[12px] text-slate-400">This usually takes 5–10 seconds</p>
                          </>
                        ) : photoError ? (
                          <>
                            <p className="mb-3 flex items-center justify-center gap-1.5 text-[13px] text-red-600">
                              <AlertTriangle size={14} /> {photoError}
                            </p>
                            <button type="button" onClick={() => { setShowPhotoImport(false); setPhotoError(null); }} className={BTN_PRIMARY}>OK</button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* URL */}
              <div className={cx(CARD, "overflow-hidden")}>
                <button
                  type="button"
                  onClick={() => setShowUrlImport((v) => !v)}
                  className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50">
                    <Link2 size={18} className="text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-semibold text-slate-900">URL / link</div>
                    <div className="mt-0.5 text-[12px] text-slate-400">Pull it off a recipe site</div>
                  </div>
                  <ChevronRight size={16} className={cx("shrink-0 text-slate-300 transition-transform duration-200", showUrlImport && "rotate-90")} />
                </button>
                {showUrlImport && (
                  <div className="animate-rise px-4 pb-4">
                    {urlImporting ? (
                      <div className="py-2 text-center">
                        <p className="text-[13px] font-medium text-slate-500">Fetching recipe…</p>
                        <p className="mt-1 text-[12px] text-slate-400">This usually takes 5–15 seconds</p>
                      </div>
                    ) : (
                      <>
                        {urlImportError && (
                          <p className="mb-2 flex items-center gap-1.5 text-[12px] text-red-600">
                            <AlertTriangle size={13} /> {urlImportError}
                          </p>
                        )}
                        <input
                          value={urlImportValue}
                          onChange={(e) => setUrlImportValue(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleUrlImport()}
                          placeholder="https://example.com/recipes/…"
                          className="w-full rounded-xl bg-slate-50 px-3 py-2.5 text-[14px] text-slate-900 ring-1 ring-slate-200 transition-shadow placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowUrlImport(false); setUrlImportValue(""); setUrlImportError(null); }}
                            className={BTN_GHOST}
                          >
                            Cancel
                          </button>
                          <button type="button" onClick={handleUrlImport} className={BTN_PRIMARY}>Import</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Sheet>
        )}

        <div className="md:pl-64">
          <AppHeader
            title="Recipes"
            subtitle={recipes.length + (recipes.length === 1 ? " recipe" : " recipes")}
            onMenu={() => setNavOpen(true)}
            right={
              <div className="flex shrink-0 items-center gap-1.5">
                <IconBtn icon={ArrowUpDown} size={15} title={sortAZ ? "Sort Z→A" : "Sort A→Z"} onClick={() => setSortAZ((v) => !v)} />
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
                    {cat}
                  </button>
                );
              })}
            </div>
          </AppHeader>

          <main className="mx-auto max-w-2xl px-4 pb-16 pt-3">
            <div className="relative mb-3">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recipes or ingredients…"
                className="w-full rounded-full bg-white py-2.5 pl-10 pr-9 text-[14.5px] text-slate-900 ring-1 ring-slate-200 transition-shadow duration-150 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={search ? "No recipes match your search." : activeTab === "Favorites" ? "No favorites yet." : "No recipes in this category yet."}
                hint={search ? "Try a different ingredient or title." : "Use the Import button to add one."}
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
                      <p className="mt-0.5 text-[12px] text-slate-400">{r.category} · {r.servings} servings</p>
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

  const cTotal = isCustom ? customTotal : storeTab === "mb" ? total : storeTab === "target" ? targetTotal : lowesTotal;
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
          right={<OverflowMenu items={menuItems} />}
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

          {/* ── Market Basket ── */}
          {storeTab === "mb" && (
            <>
              {checkedIds.size > 0 && (
                <p className="mb-2 line-clamp-2 text-[12px] italic text-slate-400">
                  From: {recipes.filter((r) => checkedIds.has(r.id)).map((r) => r.title).join(", ")}
                </p>
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
                              onToggle={toggleItem}
                              onEdit={startEdit}
                              onSaveEdit={saveEdit}
                              onCancelEdit={() => setEditingKey(null)}
                              onRemove={removeItem}
                              onAislePick={handleAislePick}
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

      <AddItemBar qty={qtyVal} setQty={setQtyVal} value={inputVal} setValue={setInputVal} onAdd={addFn} store={store} />
    </div>
  );
}
