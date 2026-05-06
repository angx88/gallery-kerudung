import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCVaMZnzTmQw0imy8BwPTTX44iNtm6R2BE",
  authDomain: "gallery-kerudung.firebaseapp.com",
  projectId: "gallery-kerudung",
  storageBucket: "gallery-kerudung.firebasestorage.app",
  messagingSenderId: "395278161010",
  appId: "1:395278161010:web:efdb013f77c79d5121deeb",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);