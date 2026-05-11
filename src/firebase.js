import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
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
