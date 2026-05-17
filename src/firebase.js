import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyDi7XwLcg8nGmYbaEqXBLvSFoQ_W9ZTqgQ",
  authDomain: "multipurpose-calendar.firebaseapp.com",
  projectId: "multipurpose-calendar",
  storageBucket: "multipurpose-calendar.firebasestorage.app",
  messagingSenderId: "55586529047",
  appId: "1:55586529047:web:70492e3322a3334affa152"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

// FCM — silently null in unsupported browsers (Firefox, old Safari)
export const messaging = (() => {
  try { return getMessaging(app); } catch { return null; }
})();

export { onMessage };

export async function registerFcmToken(vapidKey) {
  if (!messaging || !vapidKey) return null;
  try {
    const sw = await navigator.serviceWorker.ready;
    return await getToken(messaging, { vapidKey, serviceWorkerRegistration: sw });
  } catch { return null; }
}

enableIndexedDbPersistence(db).catch(err => {
  if (err.code === "failed-precondition") {
    console.warn("Firestore persistence unavailable: multiple tabs open");
  } else if (err.code === "unimplemented") {
    console.warn("Firestore persistence not supported in this browser");
  }
});
