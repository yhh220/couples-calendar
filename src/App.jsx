import { Component, useState, useEffect, useRef, useMemo, createContext, useContext } from "react";
import {
  Heart, Sun, Moon, Plus, ChevronLeft, ChevronRight, Check, X,
  LogOut, CalendarIcon, Flag, Star, Briefcase, FileText,
  Users, ImageIcon, Cake, Search, User, Lock, MessageCircle,
  Edit2, BookOpen, WifiOff, GraduationCap, ChevronDown, ChevronUp, Trash2,
} from "lucide-react";
import { auth, provider, db, storage } from "./firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy,
  setDoc, getDoc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL, deleteObject } from "firebase/storage";
import { getHolidayForDate, MY_HOLIDAYS } from "./holidays";
import "./index.css";

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────
const HIM_EMAIL = "chinyihang06@gmail.com";
const HER_EMAIL = "shinyutoo@gmail.com";
const ALLOWED_EMAILS = new Set([HIM_EMAIL, HER_EMAIL]);
const LIMITS = { title: 90, note: 400, imageBytes: 4 * 1024 * 1024, schoolRangeDays: 180 };
const ALLOWED_TYPES = new Set(["work", "assign", "social", "together", "anniversary", "exam"]);
const ALLOWED_SCHOOL_TYPES = new Set(["exam", "break", "results", "assign"]);
const ALLOWED_OWNERS = new Set(["him", "her"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const WEEKDAY_NAMES_SHORT = ["日","一","二","三","四","五","六"];
const MONTH_NAMES = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
const MIN_YEAR = 2024, MAX_YEAR = 2032;

const DEFAULT_ANNUAL_EVENTS = [
  { id: "annual-birthday-him-0202", title: "YH 生日 🎂", date: "2025-02-02", type: "anniversary", owner: "him", repeat: true, allDay: true, note: "" },
  { id: "annual-birthday-sy-1026", title: "SY 生日 🎂", date: "2025-10-26", type: "anniversary", owner: "her", repeat: true, allDay: true, note: "" },
];

const DEFAULT_SCHOOL_EVENTS = [
  { id: "inti-2026-03-30", title: "Classes Begin (April 2026 Session)", date: "2026-03-30", type: "assign", schoolType: "assign", owner: "her", source: "school", locked: true },
  { id: "inti-2026-05-18", title: "Mid Semester Break", date: "2026-05-18", endDate: "2026-05-24", type: "holiday", schoolType: "break", owner: "her", source: "school", locked: true },
  { id: "inti-2026-07-13", title: "Study Break", date: "2026-07-13", endDate: "2026-07-15", type: "holiday", schoolType: "break", owner: "her", source: "school", locked: true },
  { id: "inti-2026-07-16", title: "Final Examination", date: "2026-07-16", endDate: "2026-07-24", type: "exam", schoolType: "exam", owner: "her", source: "school", locked: true },
  { id: "inti-2026-08-07", title: "Release of Results", date: "2026-08-07", endDate: "2026-08-11", type: "assign", schoolType: "results", owner: "her", source: "school", locked: true },
  { id: "inti-2026-08-17", title: "New Semester Begins", date: "2026-08-17", type: "assign", schoolType: "assign", owner: "her", source: "school", locked: true },
];

// ─────────────────────────────────────────
// USER CONTEXT
// ─────────────────────────────────────────
const UserCtx = createContext(null);
function useMe() { return useContext(UserCtx); }

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────
function storageGet(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
function storageRemove(key) { try { localStorage.removeItem(key); } catch {} }
function safeArray(v) { return Array.isArray(v) ? v : []; }

function cleanText(value, max = 120) {
  return String(value || "").split("").map(c => { const n = c.charCodeAt(0); return n < 32 || n === 127 ? " " : c; }).join("").replace(/\s+/g, " ").trim().slice(0, max);
}

function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [y, m, d] = value.split("-").map(Number);
  const c = new Date(y, m - 1, d);
  return c.getFullYear() === y && c.getMonth() === m - 1 && c.getDate() === d;
}

function daysBetween(start, end) { return Math.round((new Date(end) - new Date(start)) / 86400000); }

function safeImageSrc(src) {
  if (!src) return null;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src)) return src;
  if (/^https:\/\/firebasestorage\.googleapis\.com\//i.test(src)) return src;
  if (/^https:\/\/storage\.googleapis\.com\//i.test(src)) return src;
  return null;
}

function storagePathFromUrl(url) {
  try {
    const match = decodeURIComponent(new URL(url).pathname).match(/\/o\/(.+)$/);
    return match ? match[1] : null;
  } catch { return null; }
}

function toDs(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayDs() { return toDs(new Date()); }

function relativeTime(timestamp) {
  if (!timestamp) return "刚刚";
  const ts = timestamp?.toMillis ? timestamp.toMillis() : Number(timestamp);
  if (!ts) return "刚刚";
  const diff = Date.now() - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  const today = new Date(); today.setHours(0,0,0,0);
  const ev = new Date(ts); ev.setHours(0,0,0,0);
  const dd = Math.floor((today - ev) / 86400000);
  if (dd === 1) return "昨天";
  if (dd < 7) return `${dd} 天前`;
  const d = new Date(ts);
  return `${d.getMonth()+1}月${d.getDate()}日`;
}

function evClass(e) {
  if (e.source === "school") {
    if (e.type === "exam") return "exam";
    if (e.type === "holiday") return "holiday";
    return "school";
  }
  if (e.type === "anniversary") return "anniversary";
  if (e.type === "together") return "together";
  if (e.type === "holiday") return "holiday";
  if (e.type === "exam") return "exam";
  return e.owner || "him";
}

function fmtDate(s) {
  if (!s) return "";
  const [y,m,d] = s.split("-").map(Number);
  return `${m}月${d}日 星期${WEEKDAY_NAMES_SHORT[new Date(y,m-1,d).getDay()]}`;
}

function fmtShort(s) {
  if (!s) return "";
  const [,m,d] = s.split("-").map(Number);
  return `${m}月${d}日`;
}

// Expand a recurring event within a given year/month, returns array of date strings
function expandRecurring(event, year, month) {
  const rec = event.recurrence;
  if (!rec || !rec.type || rec.type === "none") return [];
  const { type, startDate, endDate, weekdays, exceptions = [] } = rec;
  const results = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (startDate && ds < startDate) continue;
    if (endDate && ds > endDate) continue;
    if (exceptions.includes(ds)) continue;
    const dow = new Date(year, month-1, d).getDay();
    let matches = false;
    if (type === "daily") {
      matches = true;
    } else if (type === "weekly") {
      const baseDow = startDate ? new Date(startDate + "T00:00:00").getDay() : dow;
      matches = weekdays?.length ? weekdays.includes(dow) : dow === baseDow;
    } else if (type === "monthly") {
      const baseDay = startDate ? Number(startDate.split("-")[2]) : 1;
      matches = d === baseDay;
    } else if (type === "yearly") {
      if (startDate) { const [,sm,sd] = startDate.split("-").map(Number); matches = sm === month && sd === d; }
    } else if (type === "custom") {
      matches = weekdays?.length ? weekdays.includes(dow) : true;
    }
    if (matches && ds !== event.date) results.push(ds);
  }
  return results;
}

function getEventsForDs(s, events) {
  const [y, m, d] = s.split("-").map(Number);
  const all = [];
  const seen = new Set();
  const add = (e, key) => { if (!seen.has(key)) { seen.add(key); all.push(e); } };
  events.forEach(e => {
    if (e.date === s) { add(e, e.id); return; }
    if (e.endDate && s >= e.date && s <= e.endDate) { add({ ...e, startDate: e.date, date: s }, e.id + s); return; }
    if (e.repeat) {
      const [,em,ed] = e.date.split("-").map(Number);
      if (em === m && ed === d) { add({ ...e, date: s }, e.id + s); }
    }
    if (e.recurrence?.type && e.recurrence.type !== "none") {
      if (expandRecurring(e, y, m).includes(s)) { add({ ...e, date: s, isRecurrenceInstance: true }, e.id + s); }
    }
  });
  return all;
}

function normalizeEventInput(data, user) {
  const type = ALLOWED_TYPES.has(data.type) ? data.type : "work";
  const title = cleanText(data.title, LIMITS.title);
  const note = cleanText(data.note, LIMITS.note);
  const date = isDateString(data.date) ? data.date : null;
  if (!title || !date) return null;
  const endDate = isDateString(data.endDate) && data.endDate > date ? data.endDate : null;
  const isMultiDay = Boolean(endDate);
  const shared = type === "together" || type === "anniversary";
  const ME = user?.email === HIM_EMAIL ? "him" : "her";
  return {
    title, date, endDate, type,
    owner: shared ? null : ME,
    ownerEmail: cleanText(user?.email, 120),
    note,
    allDay: isMultiDay ? true : Boolean(data.allDay),
    time: (isMultiDay || data.allDay) || !/^\d{2}:\d{2}$/.test(String(data.time || "")) ? null : data.time,
    repeat: Boolean(data.repeat && type === "anniversary"),
    photo: safeImageSrc(data.photo) || null,
    private: !shared && Boolean(data.private),
    recurrence: data.recurrence || null,
  };
}

function normalizeSchoolInput(data) {
  const title = cleanText(data.title, LIMITS.title);
  const date = isDateString(data.date) ? data.date : null;
  const endDate = data.endDate && isDateString(data.endDate) && data.endDate >= data.date && daysBetween(data.date, data.endDate) <= LIMITS.schoolRangeDays ? data.endDate : null;
  const schoolType = ALLOWED_SCHOOL_TYPES.has(data.schoolType) ? data.schoolType : "exam";
  const owner = ALLOWED_OWNERS.has(data.owner) ? data.owner : "her";
  if (!title || !date) return null;
  return { title, date, endDate, type: data.type || "assign", schoolType, owner, source: "school", allDay: true };
}

// ─────────────────────────────────────────
// ERROR BOUNDARY
// ─────────────────────────────────────────
class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(err) { return { hasError: true, error: err }; }
  componentDidCatch(err) { console.error("[AppErrorBoundary]", err); }
  reset = () => { storageRemove("events"); storageRemove("schoolEvents"); window.location.reload(); };
  render() {
    if (this.state.hasError) return (
      <div className="crash-screen">
        <div className="crash-card">
          <div className="crash-emoji">💔</div>
          <div className="crash-title">出了点问题</div>
          <p className="crash-sub">页面遇到了错误。清理本地缓存后重试，若问题持续请刷新浏览器。</p>
          <button className="btn-submit" onClick={this.reset}>清理缓存并重启</button>
          <button className="pbtn" style={{width:"100%",marginTop:8}} onClick={() => window.location.reload()}>只刷新页面</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

// ─────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────
const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const TYPE_ICONS = {
  work: <Briefcase size={16} />, assign: <FileText size={16} />, social: <Users size={16} />,
  together: <Heart size={16} />, anniversary: <Star size={16} />, holiday: <Flag size={16} />,
  school: <FileText size={16} />, exam: <GraduationCap size={16} />,
};

// ─────────────────────────────────────────
// OFFLINE BANNER
// ─────────────────────────────────────────
function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (online) return null;
  return <div className="offline-banner"><WifiOff size={13} /> 离线模式 · 更改将在恢复网络后同步</div>;
}

// ─────────────────────────────────────────
// LOADING / AUTH SCREENS
// ─────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-card">
        <div className="loading-heart"><Heart size={36} fill="currentColor" /></div>
        <div className="loading-title">Calendar</div>
        <div className="loading-dots"><span /><span /><span /></div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  return (
    <div className="login-screen">
      <div className="login-aura login-aura-one" /><div className="login-aura login-aura-two" />
      <div className="login-card">
        <div className="login-mark"><span /><Heart size={20} fill="currentColor" /></div>
        <div className="login-title">Calendar</div>
        <div className="login-sub">Plans, dates, and reminders.</div>
        <button className="btn-google" onClick={onLogin}><GoogleLogo /> Continue with Google</button>
      </div>
    </div>
  );
}

function NoPermissionScreen({ onLogout }) {
  return (
    <div className="login-screen">
      <div className="login-aura login-aura-one" /><div className="login-aura login-aura-two" />
      <div className="login-card">
        <div className="login-mark"><span /><Heart size={20} fill="currentColor" /></div>
        <div style={{fontSize:26,fontWeight:900,margin:"8px 0 8px"}}>No Permission</div>
        <div className="login-sub" style={{marginBottom:24}}>This account is not authorized to access this calendar.</div>
        <button className="btn-google" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

function MaintenanceScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-card">
        <div className="loading-heart" style={{fontSize:36}}>🔧</div>
        <div className="loading-title">维护中</div>
        <p style={{color:"var(--muted)",fontSize:13,textAlign:"center",margin:"4px 0 0",lineHeight:1.6}}>
          我们正在更新日历<br />请稍后再回来
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// TIMER BANNER
// ─────────────────────────────────────────
function TimerBanner({ togetherDate }) {
  const start = new Date(togetherDate + "T00:00:00"); start.setHours(0,0,0,0);
  const now = new Date(); now.setHours(0,0,0,0);
  const days = Math.round((now - start) / 86400000) + 1;
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  const dateObj = new Date(togetherDate + "T00:00:00");
  let sub = `${dateObj.getFullYear()}年${dateObj.getMonth()+1}月${dateObj.getDate()}日 · `;
  if (years > 0) sub += `${years} 年 ${months % 12} 个月`;
  else if (months > 0) sub += `${months} 个月`;
  else sub += "刚刚开始";
  return (
    <div className="timer-banner">
      <div className="timer-left">
        <div className="timer-heart"><Heart size={20} fill="currentColor" /></div>
        <div>
          <div className="timer-label">我们在一起</div>
          <div className="timer-count"><span>{days}</span> 天</div>
          <div className="timer-sub">{sub}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// COUNTDOWNS
// ─────────────────────────────────────────
const CD_DAYS = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
function fmtCdDate(dateStr, showYear = false) {
  const [y,m,d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m-1, d).getDay();
  return showYear ? `${y}年${m}月${d}日 ${CD_DAYS[dow]}` : `${m}月${d}日 ${CD_DAYS[dow]}`;
}

function Countdowns({ events }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = toDs(today);
  const y = today.getFullYear();
  const items = [];

  [
    { id: "annual-birthday-sy-1026", label: "SY 生日" },
    { id: "annual-birthday-him-0202", label: "YH 生日" },
  ].forEach(({ id, label }) => {
    const ev = DEFAULT_ANNUAL_EVENTS.find(e => e.id === id);
    if (!ev) return;
    const [,em,ed] = ev.date.split("-").map(Number);
    let next = new Date(y, em-1, ed); next.setHours(0,0,0,0);
    if (next < today) next = new Date(y+1, em-1, ed);
    const days = Math.round((next - today) / 86400000);
    const dateStr = `${next.getFullYear()}-${String(em).padStart(2,'0')}-${String(ed).padStart(2,'0')}`;
    items.push({ label, name: null, dateStr, days, cat: "anniversary", icon: <Cake size={15} />, showYear: true });
  });

  const nextPublic = MY_HOLIDAYS.filter(h => h.date >= todayStr).sort((a,b) => a.date.localeCompare(b.date))[0];
  const nextBreak = events.filter(e => e.source === "school" && e.schoolType === "break" && (e.endDate || e.date) >= todayStr).sort((a,b) => a.date.localeCompare(b.date))[0];
  let nextH = null;
  if (nextPublic && nextBreak) nextH = nextBreak.date <= nextPublic.date ? { name: nextBreak.title, dateStr: nextBreak.date } : { name: nextPublic.name, dateStr: nextPublic.date };
  else if (nextBreak) nextH = { name: nextBreak.title, dateStr: nextBreak.date };
  else if (nextPublic) nextH = { name: nextPublic.name, dateStr: nextPublic.date };
  if (nextH) {
    const days = Math.max(0, Math.round((new Date(nextH.dateStr + "T00:00:00") - today) / 86400000));
    items.push({ label: "下个假期", name: nextH.name, dateStr: nextH.dateStr, days, cat: "holiday", icon: <Flag size={15} /> });
  }

  const nextT = events.filter(e => e.type === "together").map(e => {
    const d2 = new Date(e.date + "T00:00:00"); d2.setHours(0,0,0,0);
    return { ...e, diff: Math.round((d2 - today) / 86400000) };
  }).filter(e => e.diff >= 0).sort((a,b) => a.diff - b.diff)[0];
  if (nextT) items.push({ label: "下次约会", name: nextT.title, dateStr: nextT.date, days: nextT.diff, cat: "together", icon: <Heart size={15} /> });

  if (!items.length) return null;
  const count = Math.min(items.length, 4);
  return (
    <div className="countdowns" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
      {items.slice(0, 4).map((c, i) => (
        <div key={i} className={`cd-card ${c.cat}`}>
          <div className="cd-top"><div className="cd-icon">{c.icon}</div><div className="cd-label">{c.label}</div></div>
          {c.name && <div className="cd-name">{c.name}</div>}
          <div className="cd-date-row">{fmtCdDate(c.dateStr, c.showYear)}</div>
          <div className="cd-countdown">
            {c.days === 0 ? <span className="cd-today">今天！</span>
              : <><span className="cd-pre">还有</span><span className="cd-num">{c.days}</span><span className="cd-suf">天</span></>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// MONTH PICKER
// ─────────────────────────────────────────
function MonthPicker({ curDate, onSelect, onClose }) {
  const [pickerYear, setPickerYear] = useState(curDate.getFullYear());
  return (
    <div className="month-picker-overlay" onClick={e => e.target.classList.contains("month-picker-overlay") && onClose()}>
      <div className="month-picker">
        <div className="month-picker-nav">
          <button className="cal-nav-btn" onClick={() => setPickerYear(y => Math.max(MIN_YEAR, y-1))} disabled={pickerYear <= MIN_YEAR}><ChevronLeft size={16} /></button>
          <span className="month-picker-year">{pickerYear}年</span>
          <button className="cal-nav-btn" onClick={() => setPickerYear(y => Math.min(MAX_YEAR, y+1))} disabled={pickerYear >= MAX_YEAR}><ChevronRight size={16} /></button>
        </div>
        <div className="month-picker-grid">
          {MONTH_NAMES.map((name, i) => {
            const isCur = pickerYear === curDate.getFullYear() && i === curDate.getMonth();
            return <button key={i} className={`month-pill${isCur ? " active" : ""}`} onClick={() => { onSelect(new Date(pickerYear, i, 1)); onClose(); }}>{name}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────
function Calendar({ curDate, events, selDate, onSelectDay, onChangeMonth, onJumpTo, viewMode }) {
  const { user, ME } = useMe();
  const y = curDate.getFullYear(), m = curDate.getMonth();
  const [showPicker, setShowPicker] = useState(false);
  const first = new Date(y,m,1).getDay();
  const dim = new Date(y,m+1,0).getDate();
  const dipm = new Date(y,m,0).getDate();
  const today = todayDs();
  const total = Math.ceil((first+dim)/7)*7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    let day, off = 0;
    if (i < first) { day = dipm-first+i+1; off = -1; }
    else if (i >= first+dim) { day = i-first-dim+1; off = 1; }
    else day = i-first+1;
    const s = toDs(new Date(y, m+off, day));
    const allEvts = getEventsForDs(s, events);
    const evts = allEvts.filter(e => {
      if (viewMode === "mine") {
        if (e.type === "holiday" || e.type === "together" || e.type === "anniversary" || e.source === "school") return true;
        return e.owner === ME || e.ownerEmail === user?.email;
      }
      if (e.private && e.ownerEmail !== user?.email) return false;
      return true;
    });
    const holiday = getHolidayForDate(s);
    cells.push({ day, off, s, evts, holiday });
  }
  return (
    <div className="cal-card">
      {showPicker && <MonthPicker curDate={curDate} onSelect={onJumpTo} onClose={() => setShowPicker(false)} />}
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={() => onChangeMonth(-1)}><ChevronLeft size={18} /></button>
        <h2 className="cal-title-btn" onClick={() => setShowPicker(true)}>{y}年 {MONTH_NAMES[m]}</h2>
        <button className="cal-nav-btn" onClick={() => onChangeMonth(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="weekdays">{["日","一","二","三","四","五","六"].map(d => <div key={d} className="weekday">{d}</div>)}</div>
      <div className="days-grid">
        {cells.map(({ day, off, s, evts, holiday }) => {
          let cls = "day-cell";
          if (off !== 0) cls += " other-month";
          if (s === today) cls += " today";
          if (s === selDate) cls += " selected";
          if (holiday) cls += " has-holiday";
          return (
            <div key={s} className={cls} onClick={() => onSelectDay(s)}>
              <div className="day-num">{day}</div>
              <div className="day-pips">
                {evts.slice(0, 6).map((e, i) => <div key={i} className={`pip ${evClass(e)}`} />)}
                {holiday && <div className="pip holiday" />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        {[["school","学校"],["together","两人"],["anniversary","纪念日"],["holiday","节假日"],["exam","考试"]].map(([cls,lbl]) => (
          <div key={cls} className="legend-item"><div className="legend-pip" style={{background:`var(--${cls})`}} />{lbl}</div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// COMMENTS SECTION
// ─────────────────────────────────────────
function CommentsSection({ eventId }) {
  const { user } = useMe();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    const q = query(collection(db, "events", eventId, "comments"), orderBy("createdAt"));
    return onSnapshot(q, snap => setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [eventId]);

  const submit = async () => {
    const clean = cleanText(text, 300);
    if (!clean || loading) return;
    setLoading(true);
    try {
      await addDoc(collection(db, "events", eventId, "comments"), {
        text: clean,
        ownerEmail: user?.email,
        createdAt: serverTimestamp(),
      });
      setText("");
    } finally { setLoading(false); }
  };

  return (
    <div className="comments-section">
      {comments.length === 0 && <div style={{color:"var(--muted)",fontSize:12,textAlign:"center",padding:"8px 0"}}>还没有评论</div>}
      {comments.map(c => (
        <div key={c.id} className={`comment ${c.ownerEmail === HIM_EMAIL ? "him" : "her"}`}>
          <span className="comment-avatar">{c.ownerEmail === HIM_EMAIL ? "🖤" : "🩷"}</span>
          <span className="comment-text">{c.text}</span>
        </div>
      ))}
      <div className="comment-input-row">
        <input className="f-input comment-input" placeholder="写评论..." value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
        <button className="icon-btn" style={{width:32,height:32,flexShrink:0}} onClick={submit} disabled={!text.trim() || loading}>
          <Check size={13} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────
function Sidebar({ selDate, events, onDelete, onEdit, onPhotoClick, curDate, viewMode }) {
  const { user, ME } = useMe();
  const [expandedId, setExpandedId] = useState(null);
  const [expandStats, setExpandStats] = useState(false);

  const filterForView = evList => evList.filter(e => {
    if (viewMode === "mine") {
      if (e.type === "holiday" || e.type === "together" || e.type === "anniversary" || e.source === "school") return true;
      return e.owner === ME || e.ownerEmail === user?.email;
    }
    if (e.private && e.ownerEmail !== user?.email) return false;
    return true;
  });

  const evts = selDate ? filterForView(getEventsForDs(selDate, events)) : [];
  const holiday = selDate ? getHolidayForDate(selDate) : null;
  const y = curDate.getFullYear(), m = curDate.getMonth()+1;
  const pre = `${y}-${String(m).padStart(2,'0')}`;
  const monthEnd = `${pre}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`;
  const monthStart = `${pre}-01`;

  const monthEvts = filterForView(events.filter(e => {
    if (e.date >= monthStart && e.date <= monthEnd) return true;
    if (e.endDate && e.date <= monthEnd && e.endDate >= monthStart) return true;
    if (e.repeat) { const [,em] = e.date.split("-").map(Number); return em === m; }
    if (e.recurrence?.type && e.recurrence.type !== "none") {
      return expandRecurring(e, y, m).length > 0 || (e.date >= monthStart && e.date <= monthEnd);
    }
    return false;
  }));

  const holidayCount = MY_HOLIDAYS.filter(h => {
    if (!h.date.startsWith(pre)) return false;
    const dow = new Date(h.date + "T00:00:00").getDay();
    return dow >= 1 && dow <= 5;
  }).length;

  const typeCount = type => monthEvts.filter(e => e.type === type).length;
  const today = todayDs();
  const upcoming = monthEvts.map(e => {
    // yearly-repeat birthday/anniversary: project to current year
    if (e.repeat) {
      const [,em,ed] = e.date.split("-").map(Number);
      return { ...e, date: `${y}-${String(em).padStart(2,'0')}-${String(ed).padStart(2,'0')}` };
    }
    // custom recurrence: find first instance in this month that's >= today
    if (e.recurrence?.type && e.recurrence.type !== "none") {
      const instances = expandRecurring(e, y, m).filter(d => d >= today).sort();
      if (instances.length) return { ...e, date: instances[0] };
      if (e.date >= monthStart && e.date <= monthEnd && e.date >= today) return e;
      return null;
    }
    return e;
  }).filter(Boolean).filter(e => (e.endDate || e.date) >= today && e.type !== "holiday").sort((a,b) => a.date.localeCompare(b.date))[0];

  const canEdit = e => !e.locked && (e.ownerEmail === user?.email || e.type === "together" || e.type === "anniversary");
  const canDelete = e => !e.locked && (e.ownerEmail === user?.email || e.type === "together" || e.type === "anniversary");
  const ownerLabel = e => {
    if (!e.ownerEmail) return null;
    return e.ownerEmail === user?.email ? "你" : (e.ownerEmail === HIM_EMAIL ? "他" : "她");
  };

  const statsRows = [
    { key: "together", label: "约会", icon: <Heart size={16} />, color: "var(--together)" },
    { key: "anniversary", label: "纪念日", icon: <Star size={15} />, color: "var(--anniversary)" },
    { key: "exam", label: "考试", icon: <GraduationCap size={15} />, color: "var(--exam)" },
    { key: "school", label: "学校", icon: <FileText size={15} />, color: "var(--school)" },
  ];

  return (
    <div className="sidebar">
      <div className="detail-card">
        <div className="detail-title">{selDate ? fmtDate(selDate) : "选择一个日期"}</div>
        <div className="detail-sub">
          {selDate ? (evts.length || holiday ? `${evts.length + (holiday?1:0)} 个活动` : "这天没有活动") : "点击日历查看当天活动"}
        </div>
        <div className="ev-list">
          {holiday && (
            <div className="holiday-notice"><Flag size={16} /><div className="holiday-notice-text">{holiday.name}</div></div>
          )}
          {evts.length === 0 && !holiday && (
            <div className="empty-state">
              <div className="empty-icon"><CalendarIcon size={16} /></div>
              <p>{selDate ? "这天还没有活动" : "点击任意日期"}<br /><span style={{fontSize:11,opacity:.5}}>点击 + 添加</span></p>
            </div>
          )}
          {evts.map((e, i) => {
            const cls = evClass(e);
            const photoSrc = safeImageSrc(e.photo);
            const isExpanded = expandedId === (e.id + e.date);
            const ts = e.createdAt;
            const ut = e.updatedAt;
            const creator = ownerLabel(e);
            const timeStr = ts ? relativeTime(ts) : null;
            const tsMs = ts?.toMillis ? ts.toMillis() : Number(ts || 0);
            const utMs = ut?.toMillis ? ut.toMillis() : Number(ut || 0);
            const edited = ut && ts && utMs > tsMs + 1000;
            return (
              <div key={e.id + e.date} className={`ev-item ${cls}${e.private ? " private-ev" : ""}`} style={{ animationDelay: `${i * .05}s` }}>
                <div className="ev-icon">{TYPE_ICONS[e.source === "school" ? "school" : e.type] || <CalendarIcon size={16} />}</div>
                <div className="ev-body" onClick={() => setExpandedId(isExpanded ? null : (e.id + e.date))}>
                  <div className="ev-name-row">
                    <div className="ev-name">{e.title}</div>
                    {e.private && <Lock size={10} style={{ color: "var(--muted)", flexShrink: 0 }} />}
                  </div>
                  <div className="ev-meta">
                    {e.endDate ? `${fmtShort(e.startDate || e.date)} - ${fmtShort(e.endDate)}` : e.allDay ? "全天" : (e.time || "")}
                    {e.note ? ` · ${e.note}` : ""}
                  </div>
                  {creator && timeStr && (
                    <div className="ev-footer">由 {creator} 添加 · {timeStr}{edited ? " (已编辑)" : ""}</div>
                  )}
                </div>
                {photoSrc && <img className="ev-photo" src={photoSrc} alt="" onClick={() => onPhotoClick(photoSrc)} />}
                {(canEdit(e) || canDelete(e)) && (
                  <div className="ev-actions">
                    {canEdit(e) && <button className="ev-action-btn" onClick={() => onEdit(e)} title="编辑"><Edit2 size={13} /></button>}
                    {canDelete(e) && <button className="ev-action-btn del" onClick={() => onDelete(e)} title="删除"><Trash2 size={13} /></button>}
                  </div>
                )}
                {isExpanded && !e.locked && !e.private && e.id && (
                  <div className="ev-expanded" onClick={ev => ev.stopPropagation()}>
                    <CommentsSection eventId={e.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="ov-card">
        <div className="ov-header">
          <div className="ov-title">{MONTH_NAMES[m-1]}概览</div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <div className="ov-total-badge">{monthEvts.length + holidayCount} 个活动</div>
            <button className="icon-btn" style={{width:28,height:28}} onClick={() => setExpandStats(v => !v)}>
              {expandStats ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
        <div className="ov-grid">
          {statsRows.map(s => {
            const cnt = s.key === "school"
              ? monthEvts.filter(e => e.source === "school").length + holidayCount
              : typeCount(s.key);
            return (
              <div key={s.key} className="ov-stat" style={{"--stat-color": s.color}}>
                <div className="ov-stat-icon">{s.icon}</div>
                <div className="ov-stat-count">{cnt}</div>
                <div className="ov-stat-label">{s.label}</div>
              </div>
            );
          })}
        </div>
        {expandStats && (
          <div className="ov-expanded-stats">
            <div className="ov-stat-row"><span>工作</span><span>{typeCount("work")}</span></div>
            <div className="ov-stat-row"><span>作业 / Assignment</span><span>{typeCount("assign")}</span></div>
            <div className="ov-stat-row"><span>社交</span><span>{typeCount("social")}</span></div>
            <div className="ov-stat-row"><span>约会</span><span>{typeCount("together")}</span></div>
            <div className="ov-stat-row"><span>考试</span><span>{typeCount("exam")}</span></div>
            <div className="ov-stat-row"><span>公共假期</span><span>{holidayCount}</span></div>
            <div className="ov-stat-row total-row"><span>合计</span><span>{monthEvts.length + holidayCount}</span></div>
          </div>
        )}
        {upcoming && (
          <div className="ov-next">
            <div className="ov-next-label">本月下一个</div>
            <div className="ov-next-row">
              <div className={`ov-next-dot ${evClass(upcoming)}`} />
              <div className="ov-next-name">{upcoming.title}</div>
              <div className="ov-next-date">{fmtDate(upcoming.date)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// ADD / EDIT MODAL
// ─────────────────────────────────────────
function AddModal({ open, onClose, defaultDate, onSubmit, editEvent: initEdit }) {
  const { user, ME } = useMe();
  const isEdit = Boolean(initEdit);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("work");
  const [date, setDate] = useState(defaultDate || todayDs());
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [recType, setRecType] = useState("none");
  const [recEnd, setRecEnd] = useState("");
  const [recWeekdays, setRecWeekdays] = useState([0,1,2,3,4,5,6]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [photoCleared, setPhotoCleared] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (!open) return;
    if (initEdit) {
      setTitle(initEdit.title || "");
      setType(initEdit.type || "work");
      setDate(initEdit.date || defaultDate || todayDs());
      setEndDate(initEdit.endDate || "");
      setTime(initEdit.time || "");
      setAllDay(Boolean(initEdit.allDay));
      setRepeat(Boolean(initEdit.repeat));
      setNote(initEdit.note || "");
      setPhotoPreview(safeImageSrc(initEdit.photo));
      setPhoto(null);
      setPhotoCleared(false);
      setIsPrivate(Boolean(initEdit.private));
      const rec = initEdit.recurrence;
      setRecType(rec?.type || "none");
      setRecEnd(rec?.endDate || "");
      setRecWeekdays(rec?.weekdays || [0,1,2,3,4,5,6]);
    } else {
      resetForm();
      setDate(defaultDate || todayDs());
    }
  }, [open, initEdit]);

  const resetForm = () => {
    setTitle(""); setType("work"); setTime(""); setNote(""); setEndDate("");
    setAllDay(false); setRepeat(false); setPhoto(null); setPhotoPreview(null);
    setError(""); setIsPrivate(false); setPhotoCleared(false);
    setRecType("none"); setRecEnd(""); setRecWeekdays([0,1,2,3,4,5,6]);
  };

  const handlePhoto = e => {
    const file = e.target.files[0]; if (!file) return;
    setError("");
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) { setError("只支持 JPG、PNG、WEBP 或 GIF。"); e.target.value = ""; return; }
    if (file.size > LIMITS.imageBytes) { setError("图片不能超过 4MB。"); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = ev => { setPhoto(ev.target.result); setPhotoPreview(ev.target.result); };
    reader.readAsDataURL(file);
  };

  const toggleWeekday = d => setRecWeekdays(ws => ws.includes(d) ? ws.filter(w => w !== d) : [...ws, d]);

  const handleSubmit = async () => {
    if (loading) return;
    const safeTitle = cleanText(title, LIMITS.title);
    const safeNote = cleanText(note, LIMITS.note);
    if (!safeTitle) { setError("请输入活动名称。"); return; }
    if (!isDateString(date)) { setError("请选择有效日期。"); return; }
    if (endDate && (!isDateString(endDate) || endDate <= date)) { setError("结束日期必须晚于开始日期。"); return; }
    if (!ALLOWED_TYPES.has(type)) { setError("类型无效。"); return; }
    setLoading(true); setError("");
    try {
      let photoUrl = initEdit?.photo || null;
      if (photoCleared && photoUrl) {
        try {
          const oldPath = storagePathFromUrl(photoUrl);
          if (oldPath) await deleteObject(ref(storage, oldPath));
        } catch { /* ignore cleanup failure */ }
        photoUrl = null;
      }
      if (photo) {
        if (photoUrl) {
          try {
            const oldPath = storagePathFromUrl(photoUrl);
            if (oldPath) await deleteObject(ref(storage, oldPath));
          } catch { /* ignore cleanup failure */ }
        }
        const storageRef = ref(storage, `photos/${Date.now()}_${user?.uid}`);
        await uploadString(storageRef, photo, "data_url");
        photoUrl = await getDownloadURL(storageRef);
      }
      const shared = type === "together" || type === "anniversary";
      const recurrence = recType === "none" ? null : {
        type: recType,
        startDate: date,
        endDate: recEnd || null,
        weekdays: (recType === "weekly" || recType === "custom") ? recWeekdays : null,
        exceptions: initEdit?.recurrence?.exceptions || [],
      };
      const payload = {
        title: safeTitle, date, endDate: endDate || null, type,
        owner: shared ? null : ME,
        ownerEmail: user?.email,
        note: safeNote, allDay,
        time: allDay ? null : time || null,
        repeat: repeat && type === "anniversary",
        photo: photoUrl,
        private: !shared && isPrivate,
        recurrence,
      };
      if (isEdit) {
        payload.updatedAt = serverTimestamp();
      } else {
        payload.createdAt = serverTimestamp();
      }
      await onSubmit(payload, isEdit ? initEdit : null);
      resetForm(); onClose();
    } catch (err) {
      console.error(err);
      setError("保存失败，请稍后再试。");
    }
    setLoading(false);
  };

  if (!open) return null;
  const isShared = type === "together" || type === "anniversary";
  const TYPE_ACCENT = { work:"var(--him)", assign:"var(--assign)", social:"var(--social)", together:"var(--together)", anniversary:"var(--anniversary)", exam:"var(--exam)" };
  const typeList = [
    { key:"work",        label:"工作",      icon:<Briefcase size={17} /> },
    { key:"assign",      label:"Assignment", icon:<FileText size={17} /> },
    { key:"social",      label:"社交",      icon:<Users size={17} /> },
    { key:"together",    label:"约会",      icon:<Heart size={17} /> },
    { key:"anniversary", label:"纪念日",    icon:<Star size={17} /> },
    { key:"exam",        label:"考试",      icon:<GraduationCap size={17} /> },
  ];

  return (
    <div className="overlay open" onClick={e => { if (e.target.classList.contains("overlay")) { resetForm(); onClose(); } }}>
      <div className="modal" style={{"--modal-accent": TYPE_ACCENT[type] || "var(--together)"}}>
        <div className="modal-handle" />
        <div className="modal-accent-bar" />
        <div className="modal-hdr">
          <div><div className="modal-title">{isEdit ? "编辑活动" : "添加活动"}</div></div>
          <button className="modal-close" onClick={() => { resetForm(); onClose(); }}><X size={16} /></button>
        </div>

        {/* ── 活动名称 ── */}
        <div className="f-group">
          <label className="f-label">活动名称</label>
          <input className="f-input" type="text" placeholder="例：期末考试、晚餐约会..."
            maxLength={LIMITS.title} value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()} autoFocus />
        </div>

        {/* ── 类型选择 ── */}
        <div className="f-group">
          <label className="f-label">类型</label>
          <div className="type-grid">
            {typeList.map(t => (
              <button key={t.key}
                className={`type-card${type === t.key ? ` active ${t.key}` : ""}`}
                onClick={() => {
                  setType(t.key);
                  if (t.key !== "anniversary") setRepeat(false);
                  if (t.key === "together" || t.key === "anniversary") setIsPrivate(false);
                }}>
                <span className="type-card-icon">{t.icon}</span>
                <span className="type-card-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 时间 ── */}
        <div className="f-section">
          <div className="f-section-label">时间</div>
          <div className="f-row">
            <div className="f-group" style={{marginBottom:0}}>
              <label className="f-label">开始日期</label>
              <input className="f-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="f-group" style={{marginBottom:0}}>
              <label className="f-label">结束日期（选填）</label>
              <input className="f-input" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          {!endDate && (
            <div className="f-row" style={{marginTop:12}}>
              <div className="f-group" style={{marginBottom:0,opacity:allDay?.35:1,pointerEvents:allDay?"none":"all"}}>
                <label className="f-label">时间（选填）</label>
                <input className="f-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
              <div className="f-group" style={{marginBottom:0,display:"flex",alignItems:"flex-end"}}>
                <div className="toggle-row">
                  <button className={`toggle${allDay?" on":""}`} onClick={() => setAllDay(!allDay)} />
                  <span className="toggle-lbl">全天活动</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 重复设置 ── */}
        <div className="f-section">
          <div className="f-section-label">重复</div>
          {type === "anniversary" && (
            <div className="f-group"><div className="toggle-row">
              <button className={`toggle${repeat?" on":""}`} onClick={() => setRepeat(!repeat)} />
              <span className="toggle-lbl">每年自动重复</span>
            </div></div>
          )}
          <div className="f-group" style={{marginBottom: recType === "none" ? 0 : 14}}>
            <label className="f-label">重复周期</label>
            <select className="f-input" value={recType} onChange={e => setRecType(e.target.value)}>
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月同一天</option>
              <option value="yearly">每年同一天</option>
              <option value="custom">自定义（选星期）</option>
            </select>
          </div>
          {recType !== "none" && (
            <div className="f-group">
              <label className="f-label">重复截止日期（选填）</label>
              <input className="f-input" type="date" value={recEnd} min={date} onChange={e => setRecEnd(e.target.value)} />
            </div>
          )}
          {(recType === "weekly" || recType === "custom") && (
            <div className="f-group" style={{marginBottom:0}}>
              <label className="f-label">重复的星期</label>
              <div className="weekday-pills">
                {["日","一","二","三","四","五","六"].map((d, i) => (
                  <button key={i} className={`weekday-pill${recWeekdays.includes(i) ? " active" : ""}`} onClick={() => toggleWeekday(i)}>{d}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 其他选项 ── */}
        <div className="f-section">
          <div className="f-section-label">其他</div>
          {!isShared && (
            <div className="f-group"><div className="toggle-row">
              <button className={`toggle${isPrivate?" on":""}`} onClick={() => setIsPrivate(!isPrivate)} />
              <span className="toggle-lbl">🔒 私密（只有我能看到）</span>
            </div></div>
          )}
          <div className="f-group">
            <label className="f-label">备注（选填）</label>
            <input className="f-input" type="text" placeholder="地点、提醒..." maxLength={LIMITS.note} value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="f-group" style={{marginBottom:0}}>
            <label className="f-label">照片（选填）</label>
            <div className="photo-upload-area" onClick={() => !photoPreview && fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto} />
              {photoPreview ? (
                <div style={{position:"relative",display:"inline-block",width:"100%"}}>
                  <img className="photo-preview-img" src={photoPreview} alt="" onClick={() => fileRef.current?.click()} />
                  <button
                    style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,.55)",border:"none",borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#fff",flexShrink:0}}
                    onClick={e => { e.stopPropagation(); setPhoto(null); setPhotoPreview(null); setPhotoCleared(true); }}
                    title="移除照片"
                  ><X size={12} /></button>
                </div>
              ) : <div className="photo-placeholder"><ImageIcon size={22} /><span>点击上传照片</span></div>}
            </div>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
        <button className="btn-submit" onClick={handleSubmit} disabled={loading}>
          <Check size={16} /> {loading ? (isEdit ? "保存中..." : "添加中...") : (isEdit ? "保存更改" : "确认添加")}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// DELETE CONFIRM POPUP
// ─────────────────────────────────────────
function DeleteConfirmPopup({ event, onClose, onConfirm }) {
  const hasRec = event?.recurrence?.type && event.recurrence.type !== "none";
  return (
    <div className="popup-overlay" onClick={e => e.target.classList.contains("popup-overlay") && onClose()}>
      <div className="popup-box">
        <div className="popup-title">删除活动</div>
        <p style={{color:"var(--muted)",fontSize:14,margin:"8px 0 16px"}}>
          确认删除「{event?.title}」？
        </p>
        {hasRec ? (
          <div style={{display:"grid",gap:8}}>
            <button className="pbtn" onClick={() => onConfirm("this")}>只删除这一次</button>
            <button className="pbtn" onClick={() => onConfirm("future")}>删除这次及以后</button>
            <button className="pbtn" style={{color:"#b3261e"}} onClick={() => onConfirm("all")}>删除整个系列</button>
            <button className="pbtn" onClick={onClose}>取消</button>
          </div>
        ) : (
          <div className="popup-btns">
            <button className="pbtn" onClick={onClose}>取消</button>
            <button className="pbtn primary" onClick={() => onConfirm("single")}>确认删除</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// SEARCH OVERLAY
// ─────────────────────────────────────────
function SearchOverlay({ events, onClose, onJumpTo }) {
  const { user } = useMe();
  const [q, setQ] = useState("");
  const inputRef = useRef();
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const esc = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!q.trim()) return [];
    const ql = q.toLowerCase();
    const evResults = events.filter(e => {
      if (e.private && e.ownerEmail !== user?.email) return false;
      return e.title?.toLowerCase().includes(ql) || e.note?.toLowerCase().includes(ql);
    });
    const holidayResults = MY_HOLIDAYS.filter(h => h.name.toLowerCase().includes(ql))
      .map(h => ({ id: "holiday-" + h.date, date: h.date, title: h.name, type: "holiday" }));
    return [...evResults, ...holidayResults]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 40);
  }, [q, events, user]);

  const grouped = useMemo(() => {
    const m = {};
    filtered.forEach(e => { const k = e.date.slice(0,7); if (!m[k]) m[k] = []; m[k].push(e); });
    return Object.entries(m).sort(([a],[b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="overlay open search-overlay" onClick={e => e.target.classList.contains("search-overlay") && onClose()}>
      <div className="search-modal">
        <div className="search-bar">
          <Search size={16} style={{color:"var(--muted)",flexShrink:0}} />
          <input ref={inputRef} className="search-input" placeholder="搜索活动标题或备注..." value={q} onChange={e => setQ(e.target.value)} />
          <button className="modal-close" style={{width:32,height:32}} onClick={onClose}><X size={14} /></button>
        </div>
        <div className="search-results">
          {!q && <div className="empty-state"><p style={{opacity:.5,margin:0}}>输入关键词开始搜索</p></div>}
          {q && filtered.length === 0 && <div className="empty-state"><p style={{margin:0}}>没有找到结果</p></div>}
          {grouped.map(([month, evts]) => {
            const [y, mo] = month.split("-").map(Number);
            return (
              <div key={month}>
                <div className="search-month-header">{y}年{mo}月</div>
                {evts.map(e => (
                  <div key={e.id} className={`search-result-item ${evClass(e)}`}
                    onClick={() => { onJumpTo(e.date); onClose(); }}>
                    <div className="search-result-icon">{TYPE_ICONS[e.type] || <CalendarIcon size={15} />}</div>
                    <div>
                      <div className="ev-name">{e.title}</div>
                      <div className="ev-meta">{fmtDate(e.date)}{e.note ? ` · ${e.note}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// DIARY CANVAS
// ─────────────────────────────────────────
function DiaryModal({ onClose }) {
  const { user } = useMe();
  const canvasRef = useRef();
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#2c2c3a");
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingDiary, setLoadingDiary] = useState(true);
  const COLORS = ["#2c2c3a","#e8809a","#5488e8","#23a071","#c38321","#dd4f68","#7b61ff"];

  useEffect(() => {
    if (!user) { setLoadingDiary(false); return; }
    const month = toDs(new Date()).slice(0, 7);
    getDoc(doc(db, "pencil", `${user.uid}-${month}`)).then(snap => {
      if (snap.exists() && snap.data().imageUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          setHistory([canvas.toDataURL()]);
          setLoadingDiary(false);
        };
        img.onerror = () => setLoadingDiary(false);
        img.src = snap.data().imageUrl;
      } else {
        setLoadingDiary(false);
      }
    }).catch(() => setLoadingDiary(false));
  }, [user]);

  const getPos = e => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches?.[0] || e;
    const pressure = e.pointerType === "pen" ? (e.pressure || 0.5) : 0.5;
    return { x: (touch.clientX - rect.left) * (canvasRef.current.width / rect.width), y: (touch.clientY - rect.top) * (canvasRef.current.height / rect.height), pressure };
  };

  const startDraw = e => {
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const draw = e => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const pos = getPos(e);
    ctx.lineWidth = tool === "eraser" ? 24 : Math.max(1.5, pos.pressure * 7);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHistory(h => [...h, canvasRef.current.toDataURL()]);
  };

  const undo = () => {
    const newHist = history.slice(0, -1);
    setHistory(newHist);
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    if (newHist.length > 0) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = newHist[newHist.length - 1];
    }
  };

  const saveDiary = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const dataUrl = canvasRef.current.toDataURL("image/png");
      const month = toDs(new Date()).slice(0, 7);
      const storageRef = ref(storage, `diary/${user.uid}/${month}.png`);
      await uploadString(storageRef, dataUrl, "data_url");
      const url = await getDownloadURL(storageRef);
      await setDoc(doc(db, "pencil", `${user.uid}-${month}`), {
        ownerEmail: user.email, month, imageUrl: url,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } finally { setSaving(false); }
  };

  return (
    <div className="overlay open diary-overlay" onClick={e => e.target.classList.contains("diary-overlay") && onClose()}>
      <div className="diary-modal">
        <div className="modal-hdr">
          <div className="modal-title">📓 {new Date().getFullYear()}年{new Date().getMonth()+1}月 日记</div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="diary-toolbar">
          <button className={`pbtn${tool==="pen"?" primary":""}`} style={{minHeight:34,padding:"0 12px"}} onClick={() => setTool("pen")}>笔</button>
          <button className={`pbtn${tool==="eraser"?" primary":""}`} style={{minHeight:34,padding:"0 12px"}} onClick={() => setTool("eraser")}>橡皮</button>
          {COLORS.map(c => (
            <button key={c} className={`color-dot${color===c&&tool==="pen"?" selected":""}`}
              style={{background:c}} onClick={() => { setColor(c); setTool("pen"); }} />
          ))}
          <button className="pbtn" style={{minHeight:34,padding:"0 12px"}} onClick={undo} disabled={history.length===0}>撤销</button>
          <button className="pbtn primary" style={{minHeight:34,padding:"0 12px"}} onClick={saveDiary} disabled={saving}>{saving?"保存中...":"保存"}</button>
        </div>
        <div style={{position:"relative"}}>
          {loadingDiary && (
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--card)",zIndex:2,borderRadius:"0 0 20px 20px",pointerEvents:"none"}}>
              <span style={{color:"var(--muted)",fontSize:13}}>加载日记中...</span>
            </div>
          )}
          <canvas ref={canvasRef} width={680} height={460} className="diary-canvas"
            onPointerDown={startDraw} onPointerMove={draw} onPointerUp={endDraw} onPointerLeave={endDraw}
            style={{touchAction:"none",opacity:loadingDiary?0:1}} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// PROFILE DRAWER
// ─────────────────────────────────────────
function ProfileDrawer({ open, onClose, onLogout, anniversaryDate, onAnniversaryUpdate }) {
  const { user, ME } = useMe();
  const [profile, setProfile] = useState(null);
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const [annEdit, setAnnEdit] = useState(false);
  const [annVal, setAnnVal] = useState(anniversaryDate);
  const [saving, setSaving] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const annStart = new Date(anniversaryDate + "T00:00:00");
  const daysTotal = Math.round((todayStart - annStart) / 86400000) + 1;
  const nextAnn = (() => {
    const y = todayStart.getFullYear();
    const [,am,ad] = anniversaryDate.split("-").map(Number);
    let next = new Date(y, am-1, ad); next.setHours(0,0,0,0);
    if (next < todayStart) next = new Date(y+1, am-1, ad);
    return Math.round((next - todayStart) / 86400000);
  })();

  useEffect(() => {
    if (!user || !open) return;
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists()) setProfile(snap.data());
      else setProfile({ displayName: ME === "him" ? "你" : "她", avatarEmoji: ME === "him" ? "🖤" : "🩷" });
    });
  }, [user, open]);

  const saveName = async () => {
    if (!user || !nameVal.trim()) return;
    setSaving(true);
    const cleaned = cleanText(nameVal, 20);
    await setDoc(doc(db, "users", user.uid), { displayName: cleaned }, { merge: true });
    setProfile(p => ({ ...p, displayName: cleaned }));
    setEditName(false); setSaving(false);
  };

  const saveAnn = async () => {
    if (!isDateString(annVal)) return;
    setSaving(true);
    await setDoc(doc(db, "couple", "shared"), { anniversaryDate: annVal }, { merge: true });
    onAnniversaryUpdate(annVal);
    setAnnEdit(false); setSaving(false);
  };

  if (!open) return null;
  return (
    <div className="overlay open" onClick={e => e.target.classList.contains("overlay") && onClose()}>
      <div className="modal profile-modal">
        <div className="modal-handle" />
        <div className="modal-hdr">
          <div className="modal-title">个人资料</div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="profile-section">
          <div className="profile-avatar-row">
            <span className="profile-emoji">{profile?.avatarEmoji || (ME === "him" ? "🖤" : "🩷")}</span>
            <div style={{flex:1,minWidth:0}}>
              {editName ? (
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <input className="f-input" style={{width:130,minHeight:36}} value={nameVal}
                    onChange={e => setNameVal(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveName()} autoFocus />
                  <button className="pbtn primary" style={{minHeight:36,padding:"0 12px"}} onClick={saveName} disabled={saving}>保存</button>
                  <button className="pbtn" style={{minHeight:36,padding:"0 10px"}} onClick={() => setEditName(false)}>取消</button>
                </div>
              ) : (
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{fontWeight:900,fontSize:17}}>{profile?.displayName || (ME === "him" ? "你" : "她")}</span>
                  <button className="icon-btn" style={{width:28,height:28}} onClick={() => { setNameVal(profile?.displayName || ""); setEditName(true); }}><Edit2 size={12} /></button>
                </div>
              )}
              <div style={{color:"var(--muted)",fontSize:12,marginTop:3}}>{user?.email}</div>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-title">💑 在一起</div>
          <div className="profile-stat-row"><span>在一起天数</span><strong>{daysTotal} 天</strong></div>
          <div className="profile-stat-row">
            <span>纪念日</span>
            {annEdit ? (
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <input className="f-input" type="date" style={{width:140,minHeight:34}} value={annVal} onChange={e => setAnnVal(e.target.value)} />
                <button className="pbtn primary" style={{minHeight:34,padding:"0 10px"}} onClick={saveAnn} disabled={saving}>保存</button>
              </div>
            ) : (
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <strong>{anniversaryDate}</strong>
                <button className="icon-btn" style={{width:26,height:26}} onClick={() => { setAnnVal(anniversaryDate); setAnnEdit(true); }}><Edit2 size={11} /></button>
              </div>
            )}
          </div>
          <div className="profile-stat-row"><span>距下次纪念日</span><strong>{nextAnn} 天</strong></div>
        </div>

        <div className="profile-section">
          <button className="btn-submit" style={{background:"var(--her)",marginBottom:0}} onClick={() => setDiaryOpen(true)}>
            <BookOpen size={15} /> 打开日记本
          </button>
        </div>

        <div className="profile-section" style={{paddingBottom:0}}>
          <button className="btn-submit" style={{background:"rgba(127,127,127,.1)",color:"var(--text)",boxShadow:"none",marginBottom:0}} onClick={onLogout}>
            <LogOut size={15} /> 退出登录
          </button>
        </div>
      </div>
      {diaryOpen && <DiaryModal onClose={() => setDiaryOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────
// SCHOOL CALENDAR MODAL
// ─────────────────────────────────────────
function SchoolCalendarModal({ open, onClose, events, onAdd, onImport, onDelete }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayDs());
  const [endDate, setEndDate] = useState("");
  const [schoolType, setSchoolType] = useState("exam");
  const [evType, setEvType] = useState("assign");
  const [owner, setOwner] = useState("her");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const schoolTypes = [
    { key:"exam", label:"考试" }, { key:"break", label:"假期" }, { key:"results", label:"成绩" }, { key:"assign", label:"课程" },
  ];
  const evTypes = [
    { key:"assign", label:"作业/课程" }, { key:"exam", label:"考试" }, { key:"holiday", label:"假期" },
  ];

  const submitOne = async () => {
    if (loading) return;
    const safeTitle = cleanText(title, LIMITS.title);
    if (!safeTitle) { setError("请输入标题。"); return; }
    if (!isDateString(date)) { setError("请选择有效开始日期。"); return; }
    if (endDate && (!isDateString(endDate) || endDate < date)) { setError("结束日期不能早于开始日期。"); return; }
    setLoading(true); setError("");
    try {
      await onAdd({ title: safeTitle, date, endDate: endDate||null, type: evType, schoolType, owner, source: "school", allDay: true });
      setTitle(""); setEndDate("");
    } catch { setError("保存失败，请重试。"); }
    finally { setLoading(false); }
  };

  if (!open) return null;
  return (
    <div className="overlay open" onClick={e => e.target.classList.contains("overlay") && onClose()}>
      <div className="modal school-modal">
        <div className="modal-handle" />
        <div className="modal-hdr">
          <div>
            <div className="modal-title">学校日历</div>
            <div className="modal-sub">INTI · 学期关键日期管理</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="school-modal-body">
          {/* Left: Add form */}
          <div className="school-panel">
            <div className="school-panel-title">➕ 添加事件</div>
            <div className="f-group">
              <label className="f-label">标题</label>
              <input className="f-input" maxLength={LIMITS.title} value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="例：Quiz 1、Midterm..."
                onKeyDown={e => e.key === "Enter" && submitOne()} autoFocus />
            </div>
            <div className="f-group">
              <label className="f-label">开始日期</label>
              <input className="f-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="f-group">
              <label className="f-label">结束日期（选填）</label>
              <input className="f-input" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="f-row">
              <div className="f-group" style={{marginBottom:0}}>
                <label className="f-label">学校分类</label>
                <select className="f-input" value={schoolType} onChange={e => setSchoolType(e.target.value)}>
                  {schoolTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div className="f-group" style={{marginBottom:0}}>
                <label className="f-label">颜色</label>
                <select className="f-input" value={evType} onChange={e => setEvType(e.target.value)}>
                  {evTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {error && <div className="form-error" style={{marginTop:10}}>{error}</div>}
            <button className="btn-submit school-submit" style={{marginTop:14}} onClick={submitOne} disabled={loading}>
              <Plus size={16} /> {loading ? "添加中..." : "确认添加"}
            </button>
          </div>

          {/* Right: Events list */}
          <div className="school-panel">
            <div className="school-panel-title">📋 已有事件 ({events.length})</div>
            <div className="school-list">
              {events.length === 0 && (
                <div className="empty-state" style={{padding:"20px 0"}}>
                  <p style={{margin:0,fontSize:13}}>还没有自定义事件<br/><span style={{fontSize:11,opacity:.6}}>在左侧添加第一个</span></p>
                </div>
              )}
              {events.map(e => (
                <div className="school-row" key={e.id}>
                  <div style={{minWidth:0}}>
                    <div className="school-row-title">{e.title}</div>
                    <div className="ev-meta">{e.date}{e.endDate ? ` – ${e.endDate}` : ""}{e.locked ? " · 默认" : ""}</div>
                  </div>
                  {!e.locked && <button className="ev-del" onClick={() => onDelete(e)}><X size={13} /></button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// VIEW TOGGLE
// ─────────────────────────────────────────
function ViewToggle({ value, onChange }) {
  return (
    <div className="view-toggle">
      <button className={`view-opt${value==="shared"?" active":""}`} onClick={() => onChange("shared")}>共享</button>
      <button className={`view-opt${value==="mine"?" active":""}`} onClick={() => onChange("mine")}>我的</button>
    </div>
  );
}

// ─────────────────────────────────────────
// APP CONTENT
// ─────────────────────────────────────────
function AppContent() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [noPermission, setNoPermission] = useState(false);
  const [theme, setTheme] = useState(storageGet("theme", "light") || "light");
  const [curDate, setCurDate] = useState(new Date());
  const [selDate, setSelDate] = useState(todayDs());
  const [events, setEvents] = useState([]);
  const [schoolEvents, setSchoolEvents] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [viewMode, setViewMode] = useState("shared");
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const detailRef = useRef();
  const [anniversaryDate, setAnniversaryDate] = useState("2025-01-01");
  const [maintenance, setMaintenance] = useState(false);

  const ME = user?.email === HIM_EMAIL ? "him" : "her";
  const PARTNER = ME === "him" ? "her" : "him";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    storageSet("theme", theme);
  }, [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (u && !ALLOWED_EMAILS.has(u.email)) {
        setNoPermission(true); setUser(null); setAuthLoading(false); return;
      }
      setNoPermission(false); setUser(u); setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => { getRedirectResult(auth).catch(console.error); }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "events"), orderBy("date"));
    let unsub;
    const subscribe = () => {
      unsub = onSnapshot(q,
        snap => setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => { console.error("events listener error:", err); setTimeout(subscribe, 3000); }
      );
    };
    subscribe();
    return () => unsub?.();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "school_events"), orderBy("date"));
    let unsub;
    const subscribe = () => {
      unsub = onSnapshot(q,
        snap => setSchoolEvents(snap.docs.map(d => ({ id: d.id, ...d.data(), source: "school" }))),
        err => { console.error("school_events listener error:", err); setTimeout(subscribe, 3000); }
      );
    };
    subscribe();
    return () => unsub?.();
  }, [user]);

  // Listen to couple/shared for anniversary date and maintenance flag
  useEffect(() => {
    // Check maintenance mode even before login
    const unsub = onSnapshot(doc(db, "couple", "shared"), snap => {
      if (snap.exists()) {
        setMaintenance(!!snap.data().maintenance);
        if (snap.data().anniversaryDate) setAnniversaryDate(snap.data().anniversaryDate);
      }
    });
    return unsub;
  }, []);

  // Auto-scroll to event detail on mobile when a date is selected
  useEffect(() => {
    if (!selDate || !detailRef.current || window.innerWidth >= 900) return;
    const t = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => clearTimeout(t);
  }, [selDate]);

  // Bootstrap defaults on first login
  useEffect(() => {
    if (!user) return;
    DEFAULT_SCHOOL_EVENTS.forEach(item => setDoc(doc(db, "school_events", item.id), item, { merge: true }).catch(console.error));
    DEFAULT_ANNUAL_EVENTS.forEach(item => setDoc(doc(db, "events", item.id), item, { merge: true }).catch(console.error));
    // Bootstrap user profile
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (!snap.exists()) {
        const isHim = user.email === HIM_EMAIL;
        setDoc(doc(db, "users", user.uid), {
          email: user.email,
          displayName: isHim ? "你" : "她",
          avatarEmoji: isHim ? "🖤" : "🩷",
          color: isHim ? "him" : "her",
          createdAt: serverTimestamp(),
        }).catch(console.error);
      }
    });
    // Bootstrap couple/shared
    getDoc(doc(db, "couple", "shared")).then(snap => {
      if (!snap.exists()) {
        setDoc(doc(db, "couple", "shared"), { anniversaryDate: "2025-01-01", startedAt: serverTimestamp() }).catch(console.error);
      }
    });
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      // Popup blocked (e.g. some mobile browsers) — fall back to redirect
      if (e.code === "auth/popup-blocked" || e.code === "auth/popup-closed-by-user") {
        try { await signInWithRedirect(auth, provider); } catch { /* ignore */ }
      } else {
        console.error(e);
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth); setEvents([]); setSchoolEvents([]);
  };

  const handleSubmitEvent = async (data, existingEvent) => {
    if (existingEvent) {
      await updateDoc(doc(db, "events", existingEvent.id), data);
    } else {
      const safeData = normalizeEventInput(data, user);
      if (!safeData) return;
      await addDoc(collection(db, "events"), { ...safeData, createdAt: serverTimestamp() });
    }
  };

  const handleDelete = async (event, option = "single") => {
    setDeleteTarget(null);
    if (event.source === "school") {
      if (event.locked) return;
      try { await deleteDoc(doc(db, "school_events", event.id)); } catch (e) { console.error(e); }
      return;
    }
    if (option === "this" && event.recurrence?.type && event.recurrence.type !== "none") {
      // Add to exceptions
      const exceptions = [...(event.recurrence.exceptions || []), event.date];
      await updateDoc(doc(db, "events", event.id), { "recurrence.exceptions": exceptions });
      return;
    }
    if (option === "future" && event.recurrence?.type && event.recurrence.type !== "none") {
      // Set end date to day before
      const d = new Date(event.date + "T00:00:00");
      d.setDate(d.getDate() - 1);
      await updateDoc(doc(db, "events", event.id), { "recurrence.endDate": toDs(d) });
      return;
    }
    // Delete entire event (single or "all")
    if (event.photo) {
      try {
        const path = storagePathFromUrl(event.photo);
        if (path) await deleteObject(ref(storage, path));
      } catch { /* ignore storage cleanup failures */ }
    }
    try { await deleteDoc(doc(db, "events", event.id)); } catch (e) { console.error(e); }
  };

  const handleAddSchool = async (data) => {
    const safeData = normalizeSchoolInput(data);
    if (!safeData) return;
    await addDoc(collection(db, "school_events"), { ...safeData, createdAt: serverTimestamp() });
  };

  const handleDeleteSchool = async (event) => {
    if (event.locked) return;
    try { await deleteDoc(doc(db, "school_events", event.id)); } catch (e) { console.error(e); }
  };

  const handleJumpTo = dateStr => {
    if (!isDateString(dateStr)) return;
    const d = new Date(dateStr + "T00:00:00");
    setCurDate(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelDate(dateStr);
  };

  const now = new Date();
  const dayNames = ["日","一","二","三","四","五","六"];
  const todayStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${dayNames[now.getDay()]}`;
  const schoolById = new Map([...DEFAULT_SCHOOL_EVENTS, ...schoolEvents].map(ev => [ev.id, ev]));
  const allSchoolEvents = Array.from(schoolById.values());
  // Anniversary event is derived from Firestore anniversaryDate so it always reflects the correct date.
  // Filter out the old hardcoded Firestore entry (annual-anniversary-0101) to avoid duplicates.
  const anniversaryEvent = anniversaryDate ? {
    id: "synth-anniversary",
    title: "在一起纪念日",
    date: anniversaryDate,
    type: "anniversary",
    owner: null,
    repeat: true,
    allDay: true,
    note: "",
    locked: true,
  } : null;
  const firestoreEvents = events.filter(e => e.id !== "annual-anniversary-0101");
  const allEvents = [...firestoreEvents, ...allSchoolEvents, ...(anniversaryEvent ? [anniversaryEvent] : [])];

  if (authLoading) return <LoadingScreen />;
  if (maintenance && !user) return <MaintenanceScreen />;
  if (noPermission) return (
    <><div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/><NoPermissionScreen onLogout={handleLogout} /></>
  );
  if (!user) return (
    <><div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/><LoginScreen onLogin={handleLogin} /></>
  );

  return (
    <UserCtx.Provider value={{ user, ME, PARTNER }}>
      <OfflineBanner />
      <div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/>
      <div className="app">
        <header className="header">
          <div className="header-left">
            <h1><em>Calendar</em></h1>
            <p>{todayStr}</p>
          </div>
          <div className="header-right">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <button className="icon-btn" onClick={() => setTheme(t => t==="light"?"dark":"light")} title="切换主题">
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="icon-btn" onClick={() => setSearchOpen(true)} title="搜索"><Search size={17} /></button>
            <button className="icon-btn" onClick={() => setSchoolOpen(true)} title="学校日历"><GraduationCap size={17} /></button>
            <button className="icon-btn" onClick={() => setProfileOpen(true)} title="个人资料"><User size={17} /></button>
            <button className="btn-add" onClick={() => { setEditEvent(null); setModalOpen(true); }}><Plus size={18} /> 添加</button>
          </div>
        </header>

        <TimerBanner togetherDate={anniversaryDate} />
        <Countdowns events={allEvents} />

        <div className="main-grid">
          <Calendar curDate={curDate} events={allEvents} selDate={selDate}
            onSelectDay={setSelDate}
            onChangeMonth={d => setCurDate(new Date(curDate.getFullYear(), curDate.getMonth()+d, 1))}
            onJumpTo={d => setCurDate(d)}
            viewMode={viewMode} />
          <div ref={detailRef}>
            <Sidebar selDate={selDate} events={allEvents} curDate={curDate}
              viewMode={viewMode}
              onDelete={e => setDeleteTarget(e)}
              onEdit={e => { setEditEvent(e); setModalOpen(true); }}
              onPhotoClick={src => setLightboxSrc(src)} />
          </div>
        </div>
      </div>

      <button className="fab" onClick={() => { setEditEvent(null); setModalOpen(true); }}><Plus size={18} /></button>

      <AddModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditEvent(null); }}
        defaultDate={selDate}
        onSubmit={handleSubmitEvent}
        editEvent={editEvent}
      />

      <SchoolCalendarModal open={schoolOpen} onClose={() => setSchoolOpen(false)}
        events={schoolEvents} onAdd={handleAddSchool} onDelete={handleDeleteSchool} />

      {deleteTarget && (
        <DeleteConfirmPopup
          event={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={option => handleDelete(deleteTarget, option)}
        />
      )}

      {searchOpen && (
        <SearchOverlay events={allEvents} onClose={() => setSearchOpen(false)} onJumpTo={handleJumpTo} />
      )}

      <ProfileDrawer
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onLogout={handleLogout}
        anniversaryDate={anniversaryDate}
        onAnniversaryUpdate={date => setAnniversaryDate(date)}
      />

      {safeImageSrc(lightboxSrc) && (
        <div className="lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={safeImageSrc(lightboxSrc)} alt="" />
        </div>
      )}
    </UserCtx.Provider>
  );
}

// ─────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────
export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
