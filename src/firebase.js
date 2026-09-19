// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
 
const firebaseConfig = {
  apiKey: "AIzaSyAI7q0TX9kC9YSGxbmsRyfoYu2QOwof4lo",
  authDomain: "dougs-cookbook.firebaseapp.com",
  projectId: "dougs-cookbook",
  storageBucket: "dougs-cookbook.firebasestorage.app",
  messagingSenderId: "424577298187",
  appId: "1:424577298187:web:cd484271ba8c585c903c0e",
  measurementId: "G-RR94G9DBGT"
};
 
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
