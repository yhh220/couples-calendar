import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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

// FCM messaging disabled until VAPID key is configured —
// firebase/messaging is dynamically imported at runtime so it can
// never crash the app on unsupported browsers (old iOS Safari, etc.)
export const messaging = null;
export const onMessage = () => () => {};
export const registerFcmToken = async () => null;

enableIndexedDbPersistence(db).catch(err => {
  if (err.code === "failed-precondition") {
    console.warn("Firestore persistence unavailable: multiple tabs open");
  } else if (err.code === "unimplemented") {
    console.warn("Firestore persistence not supported in this browser");
  }
});
