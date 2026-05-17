import { Component, useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from "react";
import Cropper from "react-easy-crop";
import {
  Heart, Sun, Moon, Plus, ChevronLeft, ChevronRight, Check, X,
  LogOut, CalendarIcon, Flag, Star, Briefcase, FileText,
  Users, ImageIcon, Cake, Search, User, Lock, MessageCircle,
  Edit2, BookOpen, WifiOff, GraduationCap, ChevronDown, ChevronUp, Trash2, Smile, Camera, PenLine, Pencil,
} from "lucide-react";
import { auth, provider, db, storage, messaging, onMessage, registerFcmToken } from "./firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, where,
  setDoc, getDoc, updateDoc, serverTimestamp, enableNetwork,
} from "firebase/firestore";
import { ref, uploadString, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { getHolidayForDate, MY_HOLIDAYS } from "./holidays";
import "./index.css";

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────
const HIM_EMAIL = "chinyihang06@gmail.com";
const HER_EMAIL = "shinyutoo@gmail.com";
const ALLOWED_EMAILS = new Set([HIM_EMAIL, HER_EMAIL]);
const LIMITS = { title: 90, note: 400, imageBytes: 4 * 1024 * 1024, schoolRangeDays: 180 };
const ALLOWED_TYPES = new Set(["work", "assign", "social", "together", "anniversary", "exam", "personal"]);
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
  { id: "inti-2026-03-30", title: "Classes Begin (April 2026 Session)", date: "2026-03-30", type: "assign", schoolType: "assign", owner: "her", source: "school" },
  { id: "inti-2026-05-18", title: "Mid Semester Break", date: "2026-05-18", endDate: "2026-05-24", type: "holiday", schoolType: "break", owner: "her", source: "school" },
  { id: "inti-2026-07-13", title: "Study Break", date: "2026-07-13", endDate: "2026-07-15", type: "holiday", schoolType: "break", owner: "her", source: "school" },
  { id: "inti-2026-07-16", title: "Final Examination", date: "2026-07-16", endDate: "2026-07-24", type: "exam", schoolType: "exam", owner: "her", source: "school" },
  { id: "inti-2026-08-07", title: "Release of Results", date: "2026-08-07", endDate: "2026-08-11", type: "assign", schoolType: "results", owner: "her", source: "school" },
  { id: "inti-2026-08-17", title: "New Semester Begins", date: "2026-08-17", type: "assign", schoolType: "assign", owner: "her", source: "school" },
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
    return "school"; // breaks, results, assign all → blue
  }
  if (e.type === "anniversary") return "anniversary";
  if (e.type === "together") return "together";
  if (e.type === "holiday") return "holiday";
  if (e.type === "exam") return "exam";
  if (e.type === "personal") return "personal";
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
    photos: Array.isArray(data.photos) ? data.photos.filter(s => safeImageSrc(s)).slice(0, 4) : (safeImageSrc(data.photo) ? [safeImageSrc(data.photo)] : []),
    photo: null, // kept null; display code reads from photos[]
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
  school: <FileText size={16} />, exam: <GraduationCap size={16} />, personal: <Smile size={16} />,
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
function Calendar({ curDate, events, selDate, onSelectDay, onChangeMonth, onJumpTo, viewMode, calView = "month", onCalViewChange, stickerData = {}, drawingData = {} }) {
  const { user, ME } = useMe();
  const y = curDate.getFullYear(), m = curDate.getMonth();
  const [showPicker, setShowPicker] = useState(false);
  const today = todayDs();

  const filterEvts = (allEvts) => allEvts.filter(e => {
    if (viewMode === "mine") {
      if (e.type === "holiday" || e.type === "anniversary" || e.source === "school") return true;
      if (e.type === "together") return false;
      return e.owner === ME || e.ownerEmail === user?.email;
    }
    if (e.private && e.ownerEmail !== user?.email) return false;
    return true;
  });

  // Month view cells
  const first = new Date(y,m,1).getDay();
  const dim = new Date(y,m+1,0).getDate();
  const dipm = new Date(y,m,0).getDate();
  const total = Math.ceil((first+dim)/7)*7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    let day, off = 0;
    if (i < first) { day = dipm-first+i+1; off = -1; }
    else if (i >= first+dim) { day = i-first-dim+1; off = 1; }
    else day = i-first+1;
    const s = toDs(new Date(y, m+off, day));
    cells.push({ day, off, s, evts: filterEvts(getEventsForDs(s, events)), holiday: getHolidayForDate(s) });
  }

  // Week view cells — week containing curDate (Sunday start)
  const weekStart = new Date(curDate);
  weekStart.setDate(curDate.getDate() - curDate.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    const s = toDs(d);
    weekDays.push({ d, s, evts: filterEvts(getEventsForDs(s, events)), holiday: getHolidayForDate(s) });
  }

  const wSm = `${weekStart.getMonth()+1}月${weekStart.getDate()}日`;
  const wEm = weekEnd.getMonth() !== weekStart.getMonth()
    ? `${weekEnd.getMonth()+1}月${weekEnd.getDate()}日`
    : `${weekEnd.getDate()}日`;

  return (
    <div className="cal-card">
      {showPicker && <MonthPicker curDate={curDate} onSelect={onJumpTo} onClose={() => setShowPicker(false)} />}
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={() => onChangeMonth(-1)}><ChevronLeft size={18} /></button>
        <h2 className="cal-title-btn" onClick={() => setShowPicker(true)}>
          {calView === "week" ? `${y}年 ${wSm} – ${wEm}` : `${y}年 ${MONTH_NAMES[m]}`}
        </h2>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <div className="cal-view-pills">
            <button className={`cal-view-pill${calView==="month"?" active":""}`} onClick={() => onCalViewChange?.("month")}>月</button>
            <button className={`cal-view-pill${calView==="week"?" active":""}`} onClick={() => onCalViewChange?.("week")}>周</button>
          </div>
          <button className="cal-nav-btn" onClick={() => onChangeMonth(1)}><ChevronRight size={18} /></button>
        </div>
      </div>

      {calView === "week" ? (
        <div className="week-grid">
          {weekDays.map(({ d, s, evts, holiday }) => {
            let cls = "week-day-col";
            if (s === today) cls += " today";
            if (s === selDate) cls += " selected";
            return (
              <div key={s} className={cls} onClick={() => onSelectDay(s)}>
                <div className="week-day-hdr">
                  <div className="week-day-name">{WEEKDAY_NAMES_SHORT[d.getDay()]}</div>
                  <div className="week-day-num">{d.getDate()}</div>
                </div>
                {(holiday ? [{title: holiday.name, type: "holiday"},...evts] : evts).slice(0, 4).map((e, i) => (
                  <div key={i} className={`week-ev-pill ${evClass(e)}`}>{e.title}</div>
                ))}
                {evts.length + (holiday?1:0) > 4 && <div className="week-ev-more">+{evts.length + (holiday?1:0) - 4}</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <>
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
                  {drawingData[s] && (
                    <img src={drawingData[s]} className="day-drawing-thumb" alt="" />
                  )}
                  {stickerData[s]?.map((p, i) => (
                    <img key={i} src={p.imageUrl} className="day-sticker-thumb"
                      style={{ left:`${p.x*100}%`, top:`${p.y*100}%`, opacity:p.opacity, transform:`translate(-50%,-50%) rotate(${p.rotation??0}deg)` }} alt="" />
                  ))}
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
            {[["personal","特别事件"],["school","学校"],["together","两人"],["anniversary","纪念日"],["holiday","节假日"],["exam","考试"]].map(([cls,lbl]) => (
              <div key={cls} className="legend-item"><div className="legend-pip" style={{background:`var(--${cls})`}} />{lbl}</div>
            ))}
          </div>
        </>
      )}
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
function Sidebar({ selDate, events, onDelete, onEdit, onPhotoClick, curDate, viewMode, drawingData }) {
  const { user, ME } = useMe();
  const [expandedId, setExpandedId] = useState(null);
  const [expandStats, setExpandStats] = useState(false);
  const [diaryDate, setDiaryDate] = useState(null);
  const [diaryText, setDiaryText] = useState(null);
  const [diaryDraw, setDiaryDraw] = useState(null);

  const filterForView = evList => evList.filter(e => {
    if (viewMode === "mine") {
      if (e.type === "holiday" || e.type === "anniversary" || e.source === "school") return true;
      if (e.type === "together") return false;
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

  const canEdit = e => !e.locked && (e.source === "school" ? false : (e.ownerEmail === user?.email || e.type === "together" || e.type === "anniversary"));
  const canDelete = e => !e.locked && (e.source === "school" || e.ownerEmail === user?.email || e.type === "together" || e.type === "anniversary");
  const ownerLabel = e => {
    if (!e.ownerEmail) return null;
    return e.ownerEmail === user?.email ? "你" : (e.ownerEmail === HIM_EMAIL ? "他" : "她");
  };

  const statsRows = [
    { key: "together",   label: "约会",  icon: <Heart size={16} />,        color: "var(--together)" },
    { key: "anniversary",label: "纪念日", icon: <Star size={15} />,         color: "var(--anniversary)" },
    { key: "exam",       label: "考试",  icon: <GraduationCap size={15} />, color: "var(--exam)" },
    { key: "holiday",    label: "假期",  icon: <Flag size={15} />,          color: "var(--holiday)" },
    { key: "personal",   label: "特别事件", icon: <Smile size={15} />,      color: "var(--personal)" },
    { key: "school",     label: "学校",  icon: <FileText size={15} />,      color: "var(--school)" },
  ];
  const mineStatsRows = [
    { key: "exam",     label: "考试",  icon: <GraduationCap size={15} />, color: "var(--exam)" },
    { key: "assign",   label: "课业",  icon: <FileText size={15} />,      color: "var(--assign)" },
    { key: "personal", label: "特别事件", icon: <Smile size={15} />,      color: "var(--personal)" },
    { key: "social",   label: "社交",    icon: <Users size={15} />,        color: "var(--social)" },
    { key: "holiday",  label: "节假日",  icon: <Flag size={15} />,         color: "var(--holiday)" },
  ];

  return (
    <div className="sidebar">
      <div className="detail-card">
        <div className="detail-hdr-row">
          <div>
            <div className="detail-title">{selDate ? fmtDate(selDate) : "选择一个日期"}</div>
            <div className="detail-sub">
              {selDate ? (evts.length || holiday ? `${evts.length + (holiday?1:0)} 个活动` : "这天没有活动") : "点击日历查看当天活动"}
            </div>
          </div>
          {selDate && (
            <div style={{display:"flex",gap:6}}>
              <button className="icon-btn diary-draw-btn" onClick={() => setDiaryText(selDate)} title="文字日记">
                <PenLine size={16} />
              </button>
              <button className="icon-btn diary-draw-btn" onClick={() => setDiaryDraw(selDate)} title="画画">
                <Pencil size={16} />
              </button>
              <button className="icon-btn diary-draw-btn" onClick={() => setDiaryDate(selDate)} title="贴纸">
                <Edit2 size={16} />
              </button>
            </div>
          )}
        </div>
        <div className="ev-list">
          {selDate && drawingData?.[selDate] && (
            <div className="sidebar-drawing-card" onClick={() => setDiaryDraw(selDate)} style={{ marginBottom: 12, borderRadius: 16, overflow: "hidden", border: "1px solid var(--line)", background: "var(--surface-strong)", cursor: "pointer", position: "relative" }}>
              <img src={drawingData[selDate]} alt="画板" style={{ width: "100%", display: "block" }} />
              <div style={{ position: "absolute", bottom: 6, right: 8, fontSize: 11, color: "var(--muted)", fontWeight: 700, background: "var(--surface)", padding: "2px 6px", borderRadius: 8, opacity: 0.8 }}>✏️ 画板</div>
            </div>
          )}
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
            const evPhotos = (e.photos?.length ? e.photos : (e.photo ? [e.photo] : [])).filter(safeImageSrc);
            const photoSrc = evPhotos[0] || null;
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
                    {(e.type === "assign" || e.type === "exam" || e.type === "work") && e.ownerEmail && (
                      <span className={`owner-tag ${e.ownerEmail === HIM_EMAIL ? "him" : "her"}`}>
                        {e.ownerEmail === HIM_EMAIL ? "YH" : "SY"}
                      </span>
                    )}
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
                {photoSrc && (
                  <div className="ev-photo-wrap" onClick={ev => ev.stopPropagation()}>
                    <img className="ev-photo" src={photoSrc} alt="" onClick={() => onPhotoClick(evPhotos, 0)} />
                    {evPhotos.length > 1 && <span className="ev-photo-count">+{evPhotos.length - 1}</span>}
                  </div>
                )}
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

      <PhotoStrip events={evts} onPhotoClick={onPhotoClick} onEdit={onEdit} />

      <div className="ov-card">
        <div className="ov-header">
          <div className="ov-title">{MONTH_NAMES[m-1]}概览</div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <div className="ov-total-badge">
              {viewMode === "mine"
                ? typeCount("exam") + typeCount("assign") + typeCount("personal") + typeCount("social") + holidayCount
                : monthEvts.length + holidayCount} 个活动
            </div>
            <button className="icon-btn" style={{width:28,height:28}} onClick={() => setExpandStats(v => !v)}>
              {expandStats ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
        <div className={`ov-grid${viewMode === "mine" ? " ov-grid-5" : " ov-grid-6"}`}>
          {(viewMode === "mine" ? mineStatsRows : statsRows).map(s => {
            const cnt = s.key === "holiday" ? holidayCount
              : s.key === "school" ? monthEvts.filter(e => e.source === "school").length
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
            {viewMode === "mine" ? <>
              <div className="ov-stat-row"><span>考试</span><span>{typeCount("exam")}</span></div>
              <div className="ov-stat-row"><span>课业</span><span>{typeCount("assign")}</span></div>
              <div className="ov-stat-row"><span>特别事件</span><span>{typeCount("personal")}</span></div>
              <div className="ov-stat-row"><span>社交</span><span>{typeCount("social")}</span></div>
              <div className="ov-stat-row"><span>节假日</span><span>{holidayCount}</span></div>
              <div className="ov-stat-row total-row"><span>合计</span><span>{typeCount("exam") + typeCount("assign") + typeCount("personal") + typeCount("social") + holidayCount}</span></div>
            </> : <>
              <div className="ov-stat-row"><span>约会</span><span>{typeCount("together")}</span></div>
              <div className="ov-stat-row"><span>纪念日</span><span>{typeCount("anniversary")}</span></div>
              <div className="ov-stat-row"><span>考试</span><span>{typeCount("exam")}</span></div>
              <div className="ov-stat-row"><span>课业</span><span>{typeCount("assign")}</span></div>
              <div className="ov-stat-row"><span>社交</span><span>{typeCount("social")}</span></div>
              <div className="ov-stat-row"><span>工作</span><span>{typeCount("work")}</span></div>
              <div className="ov-stat-row"><span>假期</span><span>{holidayCount}</span></div>
              <div className="ov-stat-row total-row"><span>合计</span><span>{monthEvts.length + holidayCount}</span></div>
            </>}
          </div>
        )}
      </div>
      {diaryDate && <StickerModal date={diaryDate} isShared={viewMode === "shared"} onClose={() => setDiaryDate(null)} />}
      {diaryText && <DiaryTextModal date={diaryText} isShared={viewMode === "shared"} onClose={() => setDiaryText(null)} />}
      {diaryDraw && <DrawingModal date={diaryDraw} isShared={viewMode === "shared"} onClose={() => setDiaryDraw(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────
// ADD / EDIT MODAL
// ─────────────────────────────────────────
// CROP UTILITIES
// ─────────────────────────────────────────
async function getCroppedImg(imageSrc, pixelCrop) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = imageSrc; });
  const MAX = 600;
  const sc = Math.min(MAX / pixelCrop.width, MAX / pixelCrop.height, 1);
  const w = Math.round(pixelCrop.width * sc), h = Math.round(pixelCrop.height * sc);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  cv.getContext("2d").drawImage(img, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, w, h);
  return cv.toDataURL("image/webp", 0.82);
}

// ─────────────────────────────────────────
// CROP MODAL
// ─────────────────────────────────────────
const CROP_ASPECTS = [
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
];

function CropModal({ src, onConfirm, onCancel }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(1);
  const [croppedAreaPx, setCroppedAreaPx] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const onCropComplete = useCallback((_, pixels) => setCroppedAreaPx(pixels), []);

  const handleConfirm = async () => {
    if (!croppedAreaPx || confirming) return;
    setConfirming(true);
    try { onConfirm(await getCroppedImg(src, croppedAreaPx)); }
    catch { setConfirming(false); }
  };

  return (
    <div className="overlay open" style={{zIndex:120}}>
      <div className="modal crop-modal">
        <div className="modal-handle" />
        <div className="modal-hdr">
          <div><div className="modal-title">裁剪照片</div></div>
          <button className="modal-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="crop-aspect-btns">
          {CROP_ASPECTS.map(a => (
            <button key={a.label} className={`crop-aspect-btn${aspect === a.value ? " active" : ""}`}
              onClick={() => setAspect(a.value)}>{a.label}</button>
          ))}
        </div>
        <div className="crop-container">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div style={{marginTop:12}}>
          <label className="f-label">缩放</label>
          <input type="range" min={1} max={3} step={0.05} value={zoom}
            onChange={e => setZoom(+e.target.value)} style={{width:"100%"}} />
        </div>
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button className="pbtn" style={{flex:1}} onClick={onCancel}>取消</button>
          <button className="pbtn primary" style={{flex:1}} onClick={handleConfirm} disabled={confirming}>
            {confirming ? "处理中..." : "✓ 确认裁剪"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// ADD / EDIT MODAL
// ─────────────────────────────────────────
function AddModal({ open, onClose, defaultDate, onSubmit, editEvent: initEdit, viewMode }) {
  const { user, ME } = useMe();
  const isEdit = Boolean(initEdit?.id);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("work");
  const [date, setDate] = useState(defaultDate || todayDs());
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState([]); // array of compressed data URLs
  const [cropSrc, setCropSrc] = useState(null); // raw data URL awaiting crop
  const [isPrivate, setIsPrivate] = useState(false);
  const [recType, setRecType] = useState("none");
  const [recEnd, setRecEnd] = useState("");
  const [recWeekdays, setRecWeekdays] = useState([0,1,2,3,4,5,6]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();
  const MAX_PHOTOS = 4;

  useEffect(() => {
    if (!open) return;
    if (initEdit) {
      setTitle(initEdit.title || "");
      setType(initEdit.type || (viewMode === "mine" ? "personal" : "together"));
      setDate(initEdit.date || defaultDate || todayDs());
      setEndDate(initEdit.endDate || "");
      setTime(initEdit.time || "");
      setAllDay(Boolean(initEdit.allDay));
      setRepeat(Boolean(initEdit.repeat));
      setNote(initEdit.note || "");
      setPhotos(initEdit.photos?.length ? initEdit.photos.filter(s => safeImageSrc(s)) : (safeImageSrc(initEdit.photo) ? [initEdit.photo] : []));
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
    setTitle(""); setType(viewMode === "mine" ? "personal" : "together"); setTime(""); setNote(""); setEndDate("");
    setAllDay(false); setRepeat(false); setPhotos([]); setCropSrc(null);
    setError(""); setIsPrivate(false);
    setRecType("none"); setRecEnd(""); setRecWeekdays([0,1,2,3,4,5,6]);
  };

  const handlePhoto = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = "";
    setError("");
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) { setError("只支持 JPG、PNG、WEBP 或 GIF。"); return; }
    if (file.size > LIMITS.imageBytes) { setError("图片不能超过 4MB。"); return; }
    if (photos.length >= MAX_PHOTOS) { setError(`最多添加 ${MAX_PHOTOS} 张照片。`); return; }
    // Read as data URL for the crop modal
    const reader = new FileReader();
    reader.onload = ev => setCropSrc(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = (croppedDataUrl) => {
    setPhotos(prev => [...prev, croppedDataUrl]);
    setCropSrc(null);
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
      // Clean up any legacy Firebase Storage photo on edit (best-effort)
      const legacyUrl = initEdit?.photo || null;
      if (legacyUrl && storagePathFromUrl(legacyUrl)) {
        try { await deleteObject(ref(storage, storagePathFromUrl(legacyUrl))); } catch {}
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
        photos: photos.filter(s => safeImageSrc(s)),
        photo: null, // legacy field cleared
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
  const TYPE_ACCENT = { work:"var(--him)", assign:"var(--assign)", social:"var(--social)", together:"var(--together)", anniversary:"var(--anniversary)", exam:"var(--exam)", personal:"var(--personal)" };
  const typeList = viewMode === "mine"
    ? [
        { key:"personal",    label:"特别事件", icon:<Smile size={17} /> },
        { key:"social",      label:"社交",     icon:<Users size={17} /> },
        { key:"assign",      label:"课业",     icon:<FileText size={17} /> },
        { key:"exam",        label:"考试",     icon:<GraduationCap size={17} /> },
        { key:"work",        label:"工作",     icon:<Briefcase size={17} /> },
      ]
    : [
        { key:"together",    label:"约会",     icon:<Heart size={17} /> },
        { key:"anniversary", label:"纪念日",   icon:<Star size={17} /> },
        { key:"personal",    label:"特别事件", icon:<Smile size={17} /> },
        { key:"exam",        label:"考试",     icon:<GraduationCap size={17} /> },
        { key:"assign",      label:"课业",     icon:<FileText size={17} /> },
        { key:"work",        label:"工作",     icon:<Briefcase size={17} /> },
      ];

  return (
    <>
    {cropSrc && <CropModal src={cropSrc} onConfirm={handleCropConfirm} onCancel={() => setCropSrc(null)} />}
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
              <span className="toggle-lbl">🔒 只有自己能看到</span>
            </div></div>
          )}
          <div className="f-group">
            <label className="f-label">备注（选填）</label>
            <input className="f-input" type="text" placeholder="地点、提醒..." maxLength={LIMITS.note} value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="f-group" style={{marginBottom:0}}>
            <label className="f-label">照片（选填）</label>
            <p className="f-hint">最多 {MAX_PHOTOS} 张 · 保存后在活动详情中查看和放大</p>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto} />
            <div className="photo-multi-row">
              {photos.map((src, i) => (
                <div key={i} className="photo-multi-item">
                  <img src={src} alt="" draggable={false} />
                  <button className="photo-multi-del" onClick={() => setPhotos(p => p.filter((_, j) => j !== i))} title="移除">
                    <X size={10} />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button className="photo-multi-add" onClick={() => fileRef.current?.click()} title="添加照片">
                  <Plus size={20} />
                </button>
              )}
            </div>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
        <button className="btn-submit" onClick={handleSubmit} disabled={loading}>
          <Check size={16} /> {loading ? (isEdit ? "保存中..." : "添加中...") : (isEdit ? "保存更改" : "确认添加")}
        </button>
      </div>
    </div>
    </>
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
// EDIT SCOPE POPUP (recurring events)
// ─────────────────────────────────────────
function EditScopePopup({ event, onClose, onEditThis, onEditAll }) {
  return (
    <div className="popup-overlay" onClick={e => e.target.classList.contains("popup-overlay") && onClose()}>
      <div className="popup-box">
        <div className="popup-title">编辑重复活动</div>
        <p style={{color:"var(--muted)",fontSize:14,margin:"8px 0 16px"}}>「{event?.title}」是重复活动，你要修改哪些？</p>
        <div style={{display:"grid",gap:8}}>
          <button className="pbtn" onClick={onEditThis}>只修改这一次</button>
          <button className="pbtn" onClick={onEditAll}>修改整个系列</button>
          <button className="pbtn" onClick={onClose}>取消</button>
        </div>
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
// STICKER MODAL
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// PHOTO STRIP (between detail-card and ov-card)
// ─────────────────────────────────────────
function PhotoStrip({ events, onPhotoClick, onEdit }) {
  const photos = events.flatMap(e => {
    const srcs = (e.photos?.length ? e.photos : (e.photo ? [e.photo] : [])).filter(safeImageSrc);
    return srcs.map((src, idx) => ({ src, idx, allSrcs: srcs, event: e }));
  });
  if (photos.length === 0) return null;
  return (
    <div className="photo-strip">
      <div className="photo-strip-label"><ImageIcon size={13} /> 照片 ({photos.length})</div>
      <div className="photo-strip-row">
        {photos.map(({ src, idx, allSrcs, event }) => (
          <div key={event.id + "-" + idx} className="photo-strip-item">
            <img src={src} alt="" onClick={() => onPhotoClick(allSrcs, idx)} draggable={false} />
            <button className="photo-strip-edit" onClick={e => { e.stopPropagation(); onEdit(event); }} title="编辑">
              <Edit2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StickerModal({ onClose, date, isShared = false }) {
  const { user } = useMe();
  const [placements, setPlacements] = useState([]);
  const [library, setLibrary] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const canvasRef = useRef();
  // Multi-pointer tracking: pointerId → {x, y}
  const ptrsRef = useRef(new Map());
  // Current gesture state
  const gestureRef = useRef(null);
  // Mirror placements into ref so gesture handlers read latest values without stale closures
  const placementsRef = useRef([]);
  useEffect(() => { placementsRef.current = placements; }, [placements]);

  useEffect(() => {
    document.body.classList.add("diary-open");
    return () => document.body.classList.remove("diary-open");
  }, []);

  useEffect(() => {
    if (!user || !date) { setLoading(false); return; }
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists() && snap.data().stickers) setLibrary(snap.data().stickers);
    }).catch(() => {});
    const [col, key] = isShared ? ["couple", `diary_${date}`] : ["pencil", `${user.uid}-${date}`];
    getDoc(doc(db, col, key)).then(snap => {
      if (snap.exists() && Array.isArray(snap.data().placements)) setPlacements(snap.data().placements);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user, date, isShared]);

  const compress = (file) => new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 200, sc = Math.min(MAX / img.width, MAX / img.height, 1);
      const [w, h] = [Math.round(img.width * sc), Math.round(img.height * sc)];
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      res(c.toDataURL("image/webp", 0.85));
    };
    img.src = url;
  });

  const addToLibrary = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    const imageUrl = await compress(file);
    const stk = { id: `s${Date.now()}`, imageUrl };
    const newLib = [...library, stk];
    setLibrary(newLib);
    await setDoc(doc(db, "users", user.uid), { stickers: newLib }, { merge: true }).catch(console.error);
    placeSticker(imageUrl);
  };

  const placeSticker = (imageUrl) => {
    const cw = canvasRef.current?.offsetWidth || 300;
    const id = `p${Date.now()}${Math.random().toString(36).slice(2)}`;
    setPlacements(prev => [...prev, { id, imageUrl, x: 0.5, y: 0.4, w: Math.round(cw * 0.36), opacity: 1.0, rotation: 0 }]);
    setSelectedId(id);
  };

  // ── Unified canvas-level pointer handling ──────────────────────────────────
  // All events are handled here so multi-touch (Apple Pencil + finger,
  // two-finger pinch/rotate) work correctly.
  // Apple Pencil = pointerType "pen", finger = "touch", mouse = "mouse".
  // Palm rejection: only deselect on empty-canvas tap for pen/mouse, not touch.

  const onCanvasDown = (e) => {
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch {}
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const count = ptrsRef.current.size;
    const rect = canvasRef.current.getBoundingClientRect();

    // Detect which sticker (if any) was hit — bubbles up from sticker child
    const hitEl = e.target.closest('[data-sid]');
    const hitId = hitEl?.dataset.sid ?? null;

    if (count === 1) {
      if (hitId) {
        setSelectedId(hitId);
        const p = placementsRef.current.find(x => x.id === hitId);
        gestureRef.current = {
          type: 'drag', id: hitId,
          sx: e.clientX, sy: e.clientY,
          ox: p.x, oy: p.y,
          cw: rect.width, ch: rect.height,
        };
      } else {
        // Palm/finger tap on empty canvas should not deselect; pencil/mouse can
        if (e.pointerType !== 'touch') setSelectedId(null);
        gestureRef.current = null;
      }
    } else if (count === 2) {
      // Second pointer down → switch to pinch/rotate on the active sticker
      const activeId = gestureRef.current?.id ?? hitId;
      if (activeId) {
        const pts = Array.from(ptrsRef.current.values());
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const p = placementsRef.current.find(x => x.id === activeId);
        if (p) {
          gestureRef.current = {
            type: 'pinch', id: activeId,
            initDist: Math.hypot(dx, dy),
            initAngle: Math.atan2(dy, dx),
            initW: p.w,
            initRot: p.rotation ?? 0,
          };
        }
      }
    }
  };

  const onCanvasMove = (e) => {
    if (!ptrsRef.current.has(e.pointerId)) return;
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    if (!g) return;
    const count = ptrsRef.current.size;

    if (g.type === 'drag' && count === 1) {
      setPlacements(prev => prev.map(p => p.id === g.id ? {
        ...p,
        x: Math.max(0, Math.min(1, g.ox + (e.clientX - g.sx) / g.cw)),
        y: Math.max(0, Math.min(1, g.oy + (e.clientY - g.sy) / g.ch)),
      } : p));
    } else if (g.type === 'pinch' && count === 2) {
      const pts = Array.from(ptrsRef.current.values());
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const scale = dist / g.initDist;
      const rotation = g.initRot + (angle - g.initAngle) * (180 / Math.PI);
      setPlacements(prev => prev.map(p => p.id === g.id ? {
        ...p,
        w: Math.max(24, Math.min(320, Math.round(g.initW * scale))),
        rotation,
      } : p));
    }
  };

  const onCanvasUp = (e) => {
    ptrsRef.current.delete(e.pointerId);
    const count = ptrsRef.current.size;
    if (count === 0) {
      gestureRef.current = null;
    } else if (count === 1 && gestureRef.current?.type === 'pinch') {
      // One finger lifted — resume drag from remaining pointer position
      const g = gestureRef.current;
      const [, pos] = Array.from(ptrsRef.current.entries())[0];
      const rect = canvasRef.current.getBoundingClientRect();
      const p = placementsRef.current.find(x => x.id === g.id);
      if (p) {
        gestureRef.current = {
          type: 'drag', id: g.id,
          sx: pos.x, sy: pos.y,
          ox: p.x, oy: p.y,
          cw: rect.width, ch: rect.height,
        };
      }
    }
  };

  const removeFromLibrary = async (sid) => {
    const newLib = library.filter(s => s.id !== sid);
    setLibrary(newLib);
    await setDoc(doc(db, "users", user.uid), { stickers: newLib }, { merge: true }).catch(console.error);
  };

  const upd = (patch) => setPlacements(prev => prev.map(p => p.id === selectedId ? { ...p, ...patch } : p));

  const save = async () => {
    setSaving(true); setSaveErr("");
    try {
      const [col, key] = isShared ? ["couple", `diary_${date}`] : ["pencil", `${user.uid}-${date}`];
      await setDoc(doc(db, col, key), {
        date, placements,
        ...(isShared ? {} : { ownerEmail: user.email }),
        shared: isShared,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      onClose();
    } catch (err) { console.error(err); setSaveErr("保存失败"); }
    finally { setSaving(false); }
  };

  const sel = placements.find(p => p.id === selectedId);

  return (
    <div className="diary-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sticker-panel">
        <div className="diary-hdr">
          <div>
            <span className="diary-title">🌸 {date ? fmtDate(date) : ""}</span>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:2,fontWeight:600}}>
              {isShared ? "共享贴纸 · 两人都能看到" : "私人贴纸 · 只有自己看到"}
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {saveErr && <span style={{fontSize:12,color:"var(--together)",fontWeight:700}}>{saveErr}</span>}
            <button className="pbtn" onClick={onClose}>取消</button>
            <button className="pbtn primary" onClick={save} disabled={saving}>
              {saving ? "保存中..." : "✓ 保存"}
            </button>
          </div>
        </div>

        <div className="sticker-canvas" ref={canvasRef}
          onPointerDown={onCanvasDown}
          onPointerMove={onCanvasMove}
          onPointerUp={onCanvasUp}
          onPointerCancel={onCanvasUp}
        >
          {loading && <div className="diary-loading">加载中...</div>}
          {placements.map(p => (
            <div key={p.id}
              data-sid={p.id}
              className={`sticker-placed${p.id === selectedId ? " active" : ""}`}
              style={{
                left: `${p.x*100}%`,
                top: `${p.y*100}%`,
                width: `${p.w}px`,
                height: `${p.w}px`,
                opacity: p.opacity,
                transform: `translate(-50%,-50%) rotate(${p.rotation ?? 0}deg)`,
              }}
            >
              <img src={p.imageUrl} alt="" draggable={false}
                style={{width:"100%",height:"100%",objectFit:"contain",pointerEvents:"none",userSelect:"none"}} />
            </div>
          ))}
          {!loading && placements.length === 0 && (
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted)",fontSize:13,fontWeight:600,pointerEvents:"none",textAlign:"center",padding:"0 24px"}}>
              从下方选择贴纸放到画布
            </div>
          )}
        </div>

        {sel && (
          <div className="sticker-controls">
            <div className="sticker-ctrl-row">
              <span className="sticker-ctrl-lbl">透明度</span>
              <input type="range" min={0.1} max={1} step={0.05} value={sel.opacity}
                onChange={e => upd({ opacity: +e.target.value })} />
              <span className="sticker-ctrl-val">{Math.round(sel.opacity*100)}%</span>
            </div>
            <div className="sticker-ctrl-row">
              <span className="sticker-ctrl-lbl">大小</span>
              <input type="range" min={24} max={280} step={4} value={sel.w}
                onChange={e => upd({ w: +e.target.value })} />
              <span className="sticker-ctrl-val">{sel.w}px</span>
            </div>
            <div className="sticker-ctrl-row">
              <span className="sticker-ctrl-lbl">角度</span>
              <input type="range" min={-180} max={180} step={1} value={Math.round(sel.rotation ?? 0)}
                onChange={e => upd({ rotation: +e.target.value })} />
              <span className="sticker-ctrl-val">{Math.round(sel.rotation ?? 0)}°
                {Math.round(sel.rotation ?? 0) !== 0 && (
                  <button className="sticker-rot-reset" onClick={() => upd({ rotation: 0 })}>↺</button>
                )}
              </span>
            </div>
            <button className="sticker-del-btn" onClick={() => { setPlacements(p => p.filter(x => x.id !== selectedId)); setSelectedId(null); }}>
              🗑 移除贴纸
            </button>
          </div>
        )}

        <div className="sticker-lib">
          <div className="sticker-lib-row">
            <label className="sticker-lib-add">
              <input type="file" accept="image/*" style={{display:"none"}} onChange={addToLibrary} />
              <span>+</span>
            </label>
            {library.map(s => (
              <div key={s.id} className="sticker-lib-item" title="点击添加到画布">
                <img src={s.imageUrl} alt="" onClick={() => placeSticker(s.imageUrl)} draggable={false} />
                <button className="sticker-lib-del" onClick={e => { e.stopPropagation(); removeFromLibrary(s.id); }} title="从贴纸库删除">✕</button>
              </div>
            ))}
          </div>
          <p className="sticker-lib-hint">
            {library.length === 0 ? "点 + 上传贴纸图片" : "单指拖动移位 · 双指捏合旋转缩放 · Apple Pencil 精准拖动"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// DIARY TEXT MODAL
// ─────────────────────────────────────────
function DiaryTextModal({ onClose, date, isShared }) {
  const { user } = useMe();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const [col, key] = isShared ? ["couple", `diary_${date}`] : ["pencil", `${user.uid}-${date}`];
    getDoc(doc(db, col, key)).then(snap => {
      if (snap.exists()) setText(snap.data().text || "");
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user, date, isShared]);

  const save = async () => {
    setSaving(true);
    try {
      const [col, key] = isShared ? ["couple", `diary_${date}`] : ["pencil", `${user.uid}-${date}`];
      await setDoc(doc(db, col, key), {
        date, text: cleanText(text, 2000),
        ...(isShared ? {} : { ownerEmail: user.email }),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      onClose();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  return (
    <div className="overlay open" onClick={e => e.target.classList.contains("overlay") && onClose()}>
      <div className="modal">
        <div className="modal-handle" />
        <div className="modal-hdr">
          <div>
            <div className="modal-title">📔 {fmtDate(date)}</div>
            <div className="modal-sub">{isShared ? "共享日记 · 两人都能看到" : "私人日记 · 只有自己看到"}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        {loading
          ? <div style={{textAlign:"center",padding:"20px",color:"var(--muted)"}}>加载中...</div>
          : <textarea className="diary-textarea" placeholder="今天发生了什么，有什么想说的..."
              value={text} onChange={e => setText(e.target.value)} maxLength={2000} autoFocus />
        }
        {!loading && <div style={{fontSize:11,color:"var(--muted)",textAlign:"right",marginTop:4}}>{text.length}/2000</div>}
        <button className="btn-submit" style={{marginTop:12}} onClick={save} disabled={saving || loading}>
          <Check size={16} /> {saving ? "保存中..." : "保存日记"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// DRAWING MODAL
// ─────────────────────────────────────────
const DRAW_COLORS = [
  "#000000","#555555","#999999","#cccccc","#ffffff",
  "#dd4f68","#e8809a","#5488e8","#6b9bd2","#c38321","#23a071","#7b61ff",
];

function DrawingModal({ onClose, date, isShared }) {
  const { user } = useMe();
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#000000");
  const [lineWidth, setLineWidth] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [savingSticker, setSavingSticker] = useState(false);

  const commitRef = useRef(null);
  const activeRef = useRef(null);
  const containerRef = useRef(null);
  const historyRef = useRef({ past: [], future: [] });
  const strokeRef = useRef({ drawing: false, pointerId: null, pointerType: null });
  const ptsRef = useRef([]);
  const penActiveRef = useRef(false);
  const rafRef = useRef(null);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const lineWidthRef = useRef(lineWidth);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);

  const setupCanvas = useCallback((canvas, cssW, cssH) => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  }, []);

  const saveHistorySnapshot = useCallback(() => {
    const commit = commitRef.current;
    if (!commit) return;
    const ctx = commit.getContext("2d");
    const snap = ctx.getImageData(0, 0, commit.width, commit.height);
    const h = historyRef.current;
    h.past.push(snap);
    if (h.past.length > 30) h.past.shift();
    h.future = [];
    setCanUndo(h.past.length > 1);
    setCanRedo(false);
  }, []);

  useEffect(() => {
    document.body.classList.add("diary-open");
    return () => document.body.classList.remove("diary-open");
  }, []);

  useEffect(() => {
    if (!user || !containerRef.current) return;
    const container = containerRef.current;
    const cssW = container.clientWidth;
    const cssH = container.clientHeight;

    const commitCtx = setupCanvas(commitRef.current, cssW, cssH);
    setupCanvas(activeRef.current, cssW, cssH);

    const [col, key] = isShared ? ["couple", `diary_${date}`] : ["pencil", `${user.uid}-${date}`];
    getDoc(doc(db, col, key)).then(snap => {
      if (snap.exists() && snap.data().drawing) {
        const img = new Image();
        img.onload = () => {
          commitCtx.drawImage(img, 0, 0, cssW, cssH);
          saveHistorySnapshot();
          setLoading(false);
        };
        img.onerror = () => {
          commitCtx.fillStyle = "#ffffff";
          commitCtx.fillRect(0, 0, cssW, cssH);
          saveHistorySnapshot();
          setLoading(false);
        };
        img.src = snap.data().drawing;
      } else {
        commitCtx.fillStyle = "#ffffff";
        commitCtx.fillRect(0, 0, cssW, cssH);
        saveHistorySnapshot();
        setLoading(false);
      }
    }).catch(() => {
      if (commitRef.current) {
        const ctx = commitRef.current.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cssW, cssH);
        saveHistorySnapshot();
      }
      setLoading(false);
    });
  }, [user, date, isShared, setupCanvas, saveHistorySnapshot]);

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const getCanvasPoint = useCallback((e) => {
    const canvas = activeRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const renderStroke = useCallback(() => {
    const pts = ptsRef.current;
    if (pts.length < 1) return;
    const active = activeRef.current;
    if (!active) return;
    const ctx = active.getContext("2d");
    const cssW = active.offsetWidth;
    const cssH = active.offsetHeight;
    ctx.clearRect(0, 0, cssW, cssH);

    const isEraser = toolRef.current === "eraser";
    ctx.strokeStyle = isEraser ? "#ffffff" : colorRef.current;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (pts.length === 1) {
      const p = pts[0];
      const w = isEraser ? lineWidthRef.current * 4 : lineWidthRef.current * (0.4 + p.pressure * 0.6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const mx = (p.x + pts[i + 1].x) / 2;
      const my = (p.y + pts[i + 1].y) / 2;
      const w = isEraser ? lineWidthRef.current * 4 : lineWidthRef.current * (0.4 + p.pressure * 0.6);
      ctx.lineWidth = w;
      ctx.quadraticCurveTo(p.x, p.y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineWidth = isEraser ? lineWidthRef.current * 4 : lineWidthRef.current * (0.4 + last.pressure * 0.6);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }, []);

  const scheduleRender = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderStroke);
  }, [renderStroke]);

  const finalizeStroke = useCallback(() => {
    const commit = commitRef.current;
    const active = activeRef.current;
    if (!commit || !active) return;
    const commitCtx = commit.getContext("2d");
    const cssW = active.offsetWidth;
    const cssH = active.offsetHeight;
    commitCtx.drawImage(active, 0, 0, cssW, cssH);
    const activeCtx = active.getContext("2d");
    activeCtx.clearRect(0, 0, cssW, cssH);
  }, []);

  const onPointerDown = useCallback(e => {
    const canvas = activeRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch {}

    if (e.pointerType === "pen") penActiveRef.current = true;
    if (penActiveRef.current && e.pointerType === "touch") return;
    if (strokeRef.current.drawing) return;

    saveHistorySnapshot();
    const { x, y } = getCanvasPoint(e);
    const pressure = e.pointerType === "pen" ? Math.max(0.2, e.pressure || 0.5) : 1.0;
    strokeRef.current = { drawing: true, pointerId: e.pointerId, pointerType: e.pointerType };
    ptsRef.current = [{ x, y, pressure }];
    scheduleRender();
  }, [saveHistorySnapshot, getCanvasPoint, scheduleRender]);

  const onPointerMove = useCallback(e => {
    if (!strokeRef.current.drawing || e.pointerId !== strokeRef.current.pointerId) return;
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    evts.forEach(ev => {
      const { x, y } = getCanvasPoint(ev);
      const pressure = ev.pointerType === "pen" ? Math.max(0.2, ev.pressure || 0.5) : 1.0;
      ptsRef.current.push({ x, y, pressure });
    });
    scheduleRender();
  }, [getCanvasPoint, scheduleRender]);

  const onPointerUp = useCallback(e => {
    if (e.pointerId !== strokeRef.current.pointerId) return;
    if (e.pointerType === "pen") penActiveRef.current = false;
    if (strokeRef.current.drawing) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      renderStroke();
      finalizeStroke();
    }
    strokeRef.current = { drawing: false, pointerId: null, pointerType: null };
    ptsRef.current = [];
  }, [renderStroke, finalizeStroke]);

  const onPointerCancel = onPointerUp;

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length <= 1) return;
    const snap = h.past.pop();
    h.future.push(snap);
    const commit = commitRef.current;
    if (!commit) return;
    commit.getContext("2d").putImageData(h.past[h.past.length - 1], 0, 0);
    setCanUndo(h.past.length > 1);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const snap = h.future.pop();
    h.past.push(snap);
    const commit = commitRef.current;
    if (!commit) return;
    commit.getContext("2d").putImageData(snap, 0, 0);
    setCanUndo(h.past.length > 1);
    setCanRedo(h.future.length > 0);
  }, []);

  const clear = useCallback(() => {
    const commit = commitRef.current;
    if (!commit) return;
    saveHistorySnapshot();
    const ctx = commit.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, commit.offsetWidth, commit.offsetHeight);
    setConfirmClear(false);
  }, [saveHistorySnapshot]);

  const save = async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      const dataUrl = commitRef.current.toDataURL("image/png");
      const [col, key] = isShared ? ["couple", `diary_${date}`] : ["pencil", `${user.uid}-${date}`];
      await setDoc(doc(db, col, key), {
        date, drawing: dataUrl,
        ...(isShared ? {} : { ownerEmail: user.email }),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      onClose();
    } catch (err) {
      console.error(err);
      setSaveErr("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const saveAsSticker = async () => {
    const canvas = commitRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    let hasPixels = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx+1];
        const b = data[idx+2];
        const a = data[idx+3];
        // Identify non-white pixels
        if (a > 0 && (r < 250 || g < 250 || b < 250)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          hasPixels = true;
        } else {
          // Make white background transparent
          data[idx+3] = 0;
        }
      }
    }

    if (!hasPixels) {
      alert("画板是空的！");
      return;
    }

    const pad = 10;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w, maxX + pad);
    maxY = Math.min(h, maxY + pad);

    const cropW = maxX - minX;
    const cropH = maxY - minY;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = cropW;
    tempCanvas.height = cropH;
    const tempCtx = tempCanvas.getContext("2d");
    
    const cropImgData = tempCtx.createImageData(cropW, cropH);
    for (let cy = 0; cy < cropH; cy++) {
      for (let cx = 0; cx < cropW; cx++) {
        const srcIdx = ((minY + cy) * w + (minX + cx)) * 4;
        const dstIdx = (cy * cropW + cx) * 4;
        cropImgData.data[dstIdx] = data[srcIdx];
        cropImgData.data[dstIdx+1] = data[srcIdx+1];
        cropImgData.data[dstIdx+2] = data[srcIdx+2];
        cropImgData.data[dstIdx+3] = data[srcIdx+3];
      }
    }
    tempCtx.putImageData(cropImgData, 0, 0);

    tempCanvas.toBlob(async blob => {
      if (!blob) return;
      try {
        setSavingSticker(true);
        const fileRef = ref(storage, `stickers/${user.uid}/${Date.now()}_drawing.png`);
        await uploadBytes(fileRef, blob);
        const url = await getDownloadURL(fileRef);
        
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const library = userDoc.exists() && userDoc.data().stickers ? userDoc.data().stickers : [];
        const newLib = [{ id: Date.now().toString(), imageUrl: url }, ...library];
        await setDoc(doc(db, "users", user.uid), { stickers: newLib }, { merge: true });
        
        alert("成功保存为贴纸！你可以在贴纸库中找到它。");
      } catch (e) {
        console.error(e);
        alert("保存失败");
      } finally {
        setSavingSticker(false);
      }
    }, "image/png");
  };

  return (
    <div className="diary-overlay" onClick={e => e.target.classList.contains("diary-overlay") && onClose()}>
      <div className="drawing-panel">
        <div className="diary-hdr">
          <div>
            <div className="diary-title">✏️ {fmtDate(date)}</div>
            <div className="diary-sub">{isShared ? "共享画板 · 两人都能看到" : "私人画板 · 只有自己看到"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {saveErr && <span style={{ fontSize: 12, color: "#dd4f68" }}>{saveErr}</span>}
            <button className="btn-submit" style={{ padding: "6px 14px", fontSize: 13, background: "rgba(127,127,127,0.15)", color: "var(--text)", boxShadow: "none" }} onClick={saveAsSticker} disabled={savingSticker || saving || loading}>
              {savingSticker ? "处理中..." : "存为贴纸"}
            </button>
            <button className="btn-submit" style={{ padding: "6px 14px", fontSize: 13 }} onClick={save} disabled={saving || loading || savingSticker}>
              {saving ? "保存中..." : "保存"}
            </button>
            <button className="modal-close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="drawing-canvas-wrap" ref={containerRef}>
          {loading && <div className="diary-loading">加载中...</div>}
          <canvas ref={commitRef} className="drawing-canvas" style={{ zIndex: 1 }} />
          <canvas ref={activeRef} className="drawing-canvas" style={{ zIndex: 2, touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
        </div>

        <div className="draw-toolbar">
          <div className="draw-tool-row">
            <button className={`draw-tool-btn${tool === "pen" ? " active" : ""}`} onClick={() => setTool("pen")} title="画笔">
              <Pencil size={15} />
            </button>
            <button className={`draw-tool-btn${tool === "eraser" ? " active" : ""}`} onClick={() => setTool("eraser")} title="橡皮擦">
              <span style={{ fontSize: 15, lineHeight: 1 }}>◻</span>
            </button>
            <div className="draw-width-row">
              <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{lineWidth}px</span>
              <input type="range" min={1} max={20} value={lineWidth}
                onChange={e => setLineWidth(Number(e.target.value))}
                style={{ flex: 1, accentColor: "var(--accent)" }} />
            </div>
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <button className="draw-tool-btn" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">↩</button>
              <button className="draw-tool-btn" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">↪</button>
              {confirmClear
                ? <span style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                    确定清空?
                    <button className="draw-tool-btn" style={{ color: "#dd4f68" }} onClick={clear}>确认</button>
                    <button className="draw-tool-btn" onClick={() => setConfirmClear(false)}>取消</button>
                  </span>
                : <button className="draw-tool-btn" onClick={() => setConfirmClear(true)} title="清空">✕</button>
              }
            </div>
          </div>
          <div className="draw-palette">
            {DRAW_COLORS.map(c => (
              <button key={c} className={`draw-color-swatch${color === c ? " active" : ""}`}
                style={{ background: c, border: c === "#ffffff" ? "1.5px solid #ccc" : undefined }}
                onClick={() => { setColor(c); setTool("pen"); }} />
            ))}
            <input type="color" value={color}
              onChange={e => { setColor(e.target.value); setTool("pen"); }}
              title="自定义颜色"
              style={{ width: 24, height: 24, padding: 0, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// PROFILE DRAWER
// ─────────────────────────────────────────
function ProfileDrawer({ open, onClose, onLogout }) {
  const { user, ME } = useMe();
  const [profile, setProfile] = useState(null);
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user || !open) return;
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists()) setProfile(snap.data());
      else setProfile({ displayName: ME === "him" ? "YH" : "SY" });
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

  const handlePhotoChange = async e => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingPhoto(true);
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const dataUrl = ev.target.result;
        const storageRef = ref(storage, `avatars/${user.uid}`);
        await uploadString(storageRef, dataUrl, "data_url");
        const photoUrl = await getDownloadURL(storageRef);
        await setDoc(doc(db, "users", user.uid), { photoUrl }, { merge: true });
        setProfile(p => ({ ...p, photoUrl }));
      } catch (err) { console.error(err); }
      setUploadingPhoto(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const initials = (profile?.displayName || (ME === "him" ? "YH" : "SY")).slice(0, 2).toUpperCase();
  const accentColor = ME === "him" ? "var(--him)" : "var(--her)";

  if (!open) return null;
  return (
    <div className="overlay open" onClick={e => e.target.classList.contains("overlay") && onClose()}>
      <div className="modal profile-modal">
        <div className="modal-handle" />
        <div className="modal-hdr">
          <div className="modal-title">个人资料</div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Avatar */}
        <div className="profile-avatar-section">
          <button className="profile-avatar-btn" onClick={() => fileInputRef.current?.click()}
            title="点击更换头像" disabled={uploadingPhoto}>
            {profile?.photoUrl
              ? <img src={profile.photoUrl} alt="avatar" className="profile-avatar-img" />
              : <span className="profile-avatar-initials" style={{background: accentColor}}>{initials}</span>
            }
            <span className="profile-avatar-overlay">
              {uploadingPhoto ? <span className="profile-uploading" /> : <Camera size={18} />}
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhotoChange} />
        </div>

        {/* Name */}
        <div className="profile-section">
          <div className="profile-field-label">名字</div>
          {editName ? (
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input className="f-input" style={{flex:1,minHeight:38}} value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditName(false); }}
                autoFocus />
              <button className="pbtn primary" style={{minHeight:38,padding:"0 14px"}} onClick={saveName} disabled={saving}>保存</button>
              <button className="pbtn" style={{minHeight:38,padding:"0 10px"}} onClick={() => setEditName(false)}>取消</button>
            </div>
          ) : (
            <div className="profile-name-row">
              <span className="profile-display-name">{profile?.displayName || initials}</span>
              <button className="icon-btn" onClick={() => { setNameVal(profile?.displayName || ""); setEditName(true); }}>
                <Edit2 size={14} />
              </button>
            </div>
          )}
          <div className="profile-email">{user?.email}</div>
        </div>

        {/* Logout */}
        <div className="profile-section" style={{paddingBottom:0}}>
          <button className="btn-submit profile-logout-btn" onClick={onLogout}>
            <LogOut size={15} /> 退出登录
          </button>
        </div>
      </div>
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
  const [owner, setOwner] = useState("her");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const schoolTypes = [
    { key:"exam", label:"考试" }, { key:"break", label:"假期" }, { key:"results", label:"成绩" }, { key:"assign", label:"课程" },
  ];
  // Map schoolType → event type (determines color automatically)
  const schoolTypeToEvType = { exam: "exam", break: "holiday", results: "assign", assign: "assign" };

  const submitOne = async () => {
    if (loading) return;
    const safeTitle = cleanText(title, LIMITS.title);
    if (!safeTitle) { setError("请输入标题。"); return; }
    if (!isDateString(date)) { setError("请选择有效开始日期。"); return; }
    if (endDate && (!isDateString(endDate) || endDate < date)) { setError("结束日期不能早于开始日期。"); return; }
    setLoading(true); setError("");
    try {
      const evType = schoolTypeToEvType[schoolType] ?? "assign";
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
            <div className="f-group">
              <label className="f-label">学校分类</label>
              <select className="f-input" value={schoolType} onChange={e => setSchoolType(e.target.value)}>
                {schoolTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
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
                    <div className="ev-meta">{e.date}{e.endDate ? ` – ${e.endDate}` : ""}</div>
                  </div>
                  <button className="ev-del" onClick={() => onDelete(e)}><X size={13} /></button>
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
  const [lightbox, setLightbox] = useState(null); // { srcs: string[], idx: number } | null
  const [viewMode, setViewMode] = useState("shared");
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editScopeTarget, setEditScopeTarget] = useState(null);
  const [calView, setCalView] = useState("month");
  const detailRef = useRef();
  const [anniversaryDate, setAnniversaryDate] = useState("2025-01-01");
  const [maintenance, setMaintenance] = useState(false);
  const [stickerData, setStickerData] = useState({});
  const [sharedStickerData, setSharedStickerData] = useState({});
  const [drawingData, setDrawingData] = useState({});
  const [sharedDrawingData, setSharedDrawingData] = useState({});
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(storageGet("installDismissed") === "1");
  const [notifPermission, setNotifPermission] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));
  const [notifDismissed, setNotifDismissed] = useState(storageGet("notifDismissed") === "1");
  const [toast, setToast] = useState(null);

  const ME = user?.email === HIM_EMAIL ? "him" : "her";
  const PARTNER = ME === "him" ? "her" : "him";


  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    storageSet("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "light" ? "dark" : "light");

  // Gate CSS token transitions until after first render to prevent
  // a flash-transition on initial dark-mode load
  useEffect(() => { document.documentElement.classList.add("theme-ready"); }, []);

  useEffect(() => {
    const handler = e => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Auto-register FCM token if permission already granted on load
  useEffect(() => {
    if (!user || !messaging || Notification?.permission !== "granted") return;
    registerAndSaveToken(user);
  }, [user]);

  // Foreground FCM message → show toast
  useEffect(() => {
    if (!messaging) return;
    return onMessage(messaging, payload => {
      const { title, body } = payload.notification ?? {};
      setToast({ title: title ?? "", body: body ?? "" });
      const tid = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(tid);
    });
  }, []);

  // Lightbox keyboard navigation
  useEffect(() => {
    if (!lightbox) return;
    const fn = e => {
      if (e.key === "ArrowLeft") setLightbox(l => l && l.srcs.length > 1 ? {...l, idx:(l.idx-1+l.srcs.length)%l.srcs.length} : l);
      if (e.key === "ArrowRight") setLightbox(l => l && l.srcs.length > 1 ? {...l, idx:(l.idx+1)%l.srcs.length} : l);
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [lightbox]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (u && !ALLOWED_EMAILS.has(u.email)) {
        setNoPermission(true); setUser(null); setAuthLoading(false); return;
      }
      setNoPermission(false); setUser(u); setAuthLoading(false);
      // Persist email so Cloud Functions can look up FCM token by email
      if (u) setDoc(doc(db, "users", u.uid), { email: u.email }, { merge: true }).catch(() => {});
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

  // Subscribe to this user's private diary sketches (exclude any shared-flagged docs)
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "pencil"), where("ownerEmail", "==", user.email));
    const unsub = onSnapshot(q, snap => {
      const sMap = {}, dMap = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!data.date) return;
        if (data.placements?.length > 0 && !data.shared) sMap[data.date] = data.placements;
        if (data.drawing) dMap[data.date] = data.drawing;
      });
      setStickerData(sMap);
      setDrawingData(dMap);
    }, err => console.error("pencil listener:", err));
    return () => unsub();
  }, [user]);

  // Subscribe to shared diary sketches stored in couple/diary_YYYY-MM-DD
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "couple"), snap => {
      const sMap = {}, dMap = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!d.id.startsWith("diary_") || !data.date) return;
        if (data.placements?.length > 0) sMap[data.date] = data.placements;
        if (data.drawing) dMap[data.date] = data.drawing;
      });
      setSharedStickerData(sMap);
      setSharedDrawingData(dMap);
    }, err => console.error("shared diary listener:", err));
    return () => unsub();
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

  // Re-enable Firestore network when app comes back to foreground (iOS PWA kills WebSockets)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") enableNetwork(db).catch(() => {});
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Auto-scroll to sidebar when date selected on mobile
  useEffect(() => {
    if (!selDate || !detailRef.current) return;
    if (window.innerWidth > 900) return;
    const id = requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [selDate]);

  // Bootstrap defaults on first login
  useEffect(() => {
    if (!user) return;
    DEFAULT_SCHOOL_EVENTS.forEach(item =>
      getDoc(doc(db, "school_events", item.id)).then(snap => {
        if (!snap.exists()) setDoc(doc(db, "school_events", item.id), item).catch(console.error);
      })
    );
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

  const registerAndSaveToken = async (u) => {
    const vapidKey = import.meta.env.VITE_VAPID_KEY;
    if (!vapidKey) return;
    const token = await registerFcmToken(vapidKey);
    if (!token || !u) return;
    await setDoc(doc(db, "users", u.uid), { fcmToken: token }, { merge: true });
  };

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    if (result === "granted" && user) registerAndSaveToken(user);
  };

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

  const openEdit = (e) => {
    if (e.isRecurrenceInstance && e.recurrence?.type && e.recurrence.type !== "none") {
      setEditScopeTarget(e);
    } else {
      setEditEvent(e); setModalOpen(true);
    }
  };

  const handleEditThisOnly = async () => {
    if (!editScopeTarget) return;
    try {
      const exceptions = [...(editScopeTarget.recurrence?.exceptions || []), editScopeTarget.date];
      await updateDoc(doc(db, "events", editScopeTarget.id), { "recurrence.exceptions": exceptions });
    } catch (err) { console.error(err); }
    setEditEvent({ ...editScopeTarget, id: null, recurrence: null, isRecurrenceInstance: undefined });
    setModalOpen(true);
    setEditScopeTarget(null);
  };

  const handleEditAll = () => {
    setEditEvent(editScopeTarget);
    setModalOpen(true);
    setEditScopeTarget(null);
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
      {toast && (
        <div className="notif-toast">
          <div className="notif-toast-title">{toast.title}</div>
          {toast.body && <div className="notif-toast-body">{toast.body}</div>}
        </div>
      )}
      {messaging && notifPermission === "default" && !notifDismissed && (
        <div className="notif-prompt-banner">
          <span>🔔 开启通知，及时收到活动提醒</span>
          <button className="notif-prompt-btn accent" onClick={requestNotifPermission}>开启</button>
          <button className="notif-prompt-btn" onClick={() => { setNotifDismissed(true); storageSet("notifDismissed", "1"); }}>不了</button>
        </div>
      )}
      {deferredPrompt && !installDismissed && (
        <div style={{
          position: "fixed", bottom: 88, left: 16, right: 16, zIndex: 150,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 20, padding: "14px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "var(--shadow)", gap: 12,
        }}>
          <div style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>安装 Calendar App</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>添加到主屏幕，随时使用</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setInstallDismissed(true); storageSet("installDismissed", "1"); }}
              style={{ border: "1px solid var(--line)", background: "none", borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "var(--text)" }}>
              不了
            </button>
            <button onClick={async () => {
              deferredPrompt.prompt();
              const { outcome } = await deferredPrompt.userChoice;
              if (outcome === "accepted") setDeferredPrompt(null);
            }}
              style={{ background: "var(--together)", color: "white", border: "none", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              安装
            </button>
          </div>
        </div>
      )}
      <div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/>
      <div className="app">
        <header className="header">
          <div className="header-left">
            <h1><em>Calendar</em></h1>
            <p>{todayStr}</p>
          </div>
          <div className="header-right">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <div className="header-actions">
              <button className="icon-btn" onClick={() => setSearchOpen(true)} title="搜索"><Search size={17} /></button>
              <button className="icon-btn" onClick={() => setSchoolOpen(true)} title="学校日历"><GraduationCap size={17} /></button>
              <button className="icon-btn" onClick={() => setProfileOpen(true)} title="个人资料"><User size={17} /></button>
              <div className="nav-divider" />
              <button className="icon-btn" onClick={toggleTheme} title="切换主题">
                {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
              </button>
            </div>
          </div>
        </header>

        <TimerBanner togetherDate={anniversaryDate} />
        <Countdowns events={allEvents} />

        <div className="main-grid">
          <Calendar curDate={curDate} events={allEvents} selDate={selDate}
            onSelectDay={setSelDate}
            onChangeMonth={d => {
              if (calView === "week") {
                const nd = new Date(curDate); nd.setDate(nd.getDate() + d * 7); setCurDate(nd);
              } else {
                setCurDate(new Date(curDate.getFullYear(), curDate.getMonth()+d, 1));
              }
            }}
            onJumpTo={d => setCurDate(d)}
            viewMode={viewMode}
            calView={calView}
            onCalViewChange={setCalView}
            stickerData={viewMode === "mine" ? stickerData : sharedStickerData}
            drawingData={viewMode === "mine" ? drawingData : sharedDrawingData} />
          <div ref={detailRef}>
            <Sidebar selDate={selDate} events={allEvents} curDate={curDate}
              viewMode={viewMode}
              drawingData={viewMode === "mine" ? drawingData : sharedDrawingData}
              onDelete={e => setDeleteTarget(e)}
              onEdit={e => openEdit(e)}
              onPhotoClick={(srcs, idx) => setLightbox({ srcs, idx })} />
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
        viewMode={viewMode}
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

      {editScopeTarget && (
        <EditScopePopup
          event={editScopeTarget}
          onClose={() => setEditScopeTarget(null)}
          onEditThis={handleEditThisOnly}
          onEditAll={handleEditAll}
        />
      )}

      {searchOpen && (
        <SearchOverlay events={allEvents} onClose={() => setSearchOpen(false)} onJumpTo={handleJumpTo} />
      )}

      <ProfileDrawer
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onLogout={handleLogout}
      />

      {lightbox && safeImageSrc(lightbox.srcs[lightbox.idx]) && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.srcs[lightbox.idx]} alt="" onClick={e => e.stopPropagation()} />
          {lightbox.srcs.length > 1 && <>
            <button className="lightbox-prev" onClick={e => { e.stopPropagation(); setLightbox(l => ({...l, idx:(l.idx-1+l.srcs.length)%l.srcs.length})); }}>&#8249;</button>
            <button className="lightbox-next" onClick={e => { e.stopPropagation(); setLightbox(l => ({...l, idx:(l.idx+1)%l.srcs.length})); }}>&#8250;</button>
            <div className="lightbox-counter">{lightbox.idx+1} / {lightbox.srcs.length}</div>
          </>}
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
