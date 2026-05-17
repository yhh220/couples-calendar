const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const fcm = getMessaging();

const HIM_EMAIL = "chinyihang06@gmail.com";
const HER_EMAIL = "shinyutoo@gmail.com";

const NOTIF_TYPES = ["together", "personal", "anniversary"];
const SHARED_TYPES = ["together", "anniversary"];
const REMINDER_DAYS = [7, 3, 1];

async function getTokenForEmail(email) {
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data().fcmToken ?? null;
}

async function sendPush(token, title, body) {
  if (!token) return;
  try {
    await fcm.send({
      token,
      notification: { title, body },
      webpush: {
        notification: {
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
        },
      },
    });
  } catch (err) {
    // Token may be stale — log but don't throw
    console.warn("FCM send failed:", err.code, err.message);
  }
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Notify partner immediately when a shared (together / anniversary) event is created
exports.onEventCreated = onDocumentCreated("events/{eventId}", async event => {
  const data = event.data.data();
  if (!SHARED_TYPES.includes(data.type)) return;

  const partnerEmail = data.ownerEmail === HIM_EMAIL ? HER_EMAIL : HIM_EMAIL;
  const token = await getTokenForEmail(partnerEmail);
  const who = data.ownerEmail === HIM_EMAIL ? "YH" : "SY";
  await sendPush(token, `📅 ${data.title}`, `${who} 添加了 ${data.date ?? ""} 的活动`);
});

// Daily reminders at 8 AM Malaysia time (UTC+8 = 00:00 UTC)
// Sends pushes for events happening in 1, 3, and 7 days
exports.sendDailyReminders = onSchedule("0 0 * * *", async () => {
  const nowUtc8 = new Date(Date.now() + 8 * 3600 * 1000);
  const todayDs = nowUtc8.toISOString().slice(0, 10);

  const [himToken, herToken] = await Promise.all([
    getTokenForEmail(HIM_EMAIL),
    getTokenForEmail(HER_EMAIL),
  ]);

  for (const days of REMINDER_DAYS) {
    const targetDs = addDays(todayDs, days);
    const snap = await db.collection("events")
      .where("date", "==", targetDs)
      .where("type", "in", NOTIF_TYPES)
      .get();

    if (snap.empty) continue;

    const prefix = days === 1 ? "明天" : `${days} 天后`;

    for (const d of snap.docs) {
      const ev = d.data();
      const title = `${prefix}：${ev.title}`;
      const body = ev.time ? `时间：${ev.time}` : "全天活动";
      const isShared = SHARED_TYPES.includes(ev.type);
      const ownerIsHim = ev.ownerEmail === HIM_EMAIL;

      if (isShared) {
        await Promise.all([
          sendPush(himToken, title, body),
          sendPush(herToken, title, body),
        ]);
      } else if (ownerIsHim) {
        await sendPush(himToken, title, body);
      } else {
        await sendPush(herToken, title, body);
      }
    }
  }
});
