// רשימת הגדלים המוכנים.
// כדי להוסיף גודל חדש: מעתיקים שורה, משנים שם/רוחב/גובה ושומרים.
//
// אפשר לקבוע לכל גודל הגדרות קבועות (לא חובה). מה שנקבע כאן גובר על הבחירה באתר, רק לגודל הזה:
//   background — "original" (רקע מקורי), "white" (לבן), "transparent" (שקוף) או צבע, למשל "#f2f2f2"
//   format     — "jpeg", "png", "webp" או "avif"
//   maxKB      — גודל קובץ מקסימלי, למשל 150
//   fit        — "auto" (אוטומטי), "cover" (למלא את כל הגודל) או "contain" (בלי חיתוך)
// לדוגמה: { name: "Product Image", width: 350, height: 350, background: "white", maxKB: 150 },
window.PRESETS = [
  { name: "Author Profile Pic",    width: 60,  height: 60 },
  { name: "Featured image (Lobby)", width: 500, height: 300 },
  { name: "Column Image",          width: 510, height: 340 },
  { name: "Solution Image",        width: 500, height: 610 },
  { name: "Carousel",              width: 380, height: 260 },
  { name: "Product Image",         width: 350, height: 350 },
];

