export const landRegistrationWords = {
  en: {
    start: "Record land identification",
    title: "Online land identification",
    notice:
      "This online form keeps values only in this tab. Reloading, closing or a browser crash can lose them. Keep this tab open until the result is confirmed. Offline land/GPS storage is not enabled.",
    rules:
      "Select a configured location. Label, GPS, accuracy and reported hectares are optional. Points and areas identify reported land only; they do not establish legal boundaries, ownership, verified acreage or geographic containment. No farmer or project relationship is created. Reading the result requires separate permission.",
    locked: "Land draft locked",
    retained:
      "The values or fixed request remain in this tab. Reopen with the original account and approved device after checking current land-create coverage.",
    resume: "Check access and reopen land",
    loading: "Checking land registration access…",
    unavailable:
      "Current land access could not be confirmed. Values remain hidden. Check your account, approved device, connection and coverage.",
    fixed:
      "Retry this fixed request unchanged to confirm an uncertain result. Do not create another land record for the same submission.",
    conflict:
      "The request conflicts with an existing submission. Nothing was overwritten. Keep this tab for review with an authorized administrator.",
    discard: "Discard land draft",
    discarding: "Checking the draft account…",
    discardConfirm:
      "Discard this tab's land values and fixed request? The server may already have accepted the request; discarding cannot undo it. Check uncertain outcomes with an authorized administrator before recording the same land again.",
    saved:
      "Land identification accepted. The directory is being refreshed with current read permissions.",
  },
  si: {
    start: "ඉඩම් හඳුනාගැනීම සටහන් කරන්න",
    title: "මාර්ගගත ඉඩම් හඳුනාගැනීම",
    notice:
      "මෙම මාර්ගගත පෝරමයේ අගයන් මෙම ටැබයේ පමණක් පවතී. නැවත පූරණය කිරීමෙන්, වැසීමෙන් හෝ බ්‍රවුසරය බිඳවැටීමෙන් ඒවා නැති විය හැක. ප්‍රතිඵලය තහවුරු වන තුරු ටැබය විවෘතව තබන්න. නොබැඳි ඉඩම් හෝ GPS ගබඩාව සක්‍රිය කර නැත.",
    rules:
      "සකසා ඇති ස්ථානයක් තෝරන්න. නාමය, GPS, නිරවද්‍යතාව සහ වාර්තා කළ හෙක්ටයාර විකල්පයි. ලක්ෂ්‍ය හා වපසරිය ඉඩම හඳුනාගැනීමට පමණි; ඒවා නීතිමය මායිම්, අයිතිය, තහවුරු කළ වපසරිය හෝ භූගෝලීය සීමාව තුළ පිහිටීම සනාථ නොකරයි. ගොවියෙකුට හෝ ව්‍යාපෘතියකට සම්බන්ධ නොකරයි. ප්‍රතිඵලය කියවීමට වෙනම අවසර අවශ්‍යයි.",
    locked: "ඉඩම් කෙටුම්පත අගුළු දමා ඇත",
    retained:
      "අගයන් හෝ නොවෙනස් ඉල්ලීම මෙම ටැබයේ පවතී. වත්මන් ඉඩම් ලියාපදිංචි අවසර පරීක්ෂා කර මුල් ගිණුම සහ අනුමත උපාංගයෙන් නැවත විවෘත කරන්න.",
    resume: "අවසර පරීක්ෂා කර ඉඩම නැවත විවෘත කරන්න",
    loading: "ඉඩම් ලියාපදිංචි අවසර පරීක්ෂා කරමින්…",
    unavailable:
      "වත්මන් ඉඩම් අවසර තහවුරු කළ නොහැකි විය. අගයන් සඟවා ඇත. ගිණුම, අනුමත උපාංගය, සම්බන්ධතාවය සහ ආවරණය පරීක්ෂා කරන්න.",
    fixed:
      "අවිනිශ්චිත ප්‍රතිඵලය තහවුරු කිරීමට නොවෙනස් ඉල්ලීමම නැවත උත්සාහ කරන්න. එම යැවීම සඳහා තවත් ඉඩම් වාර්තාවක් සාදන්න එපා.",
    conflict:
      "ඉල්ලීම පවතින යැවීමක් සමඟ ගැටේ. දත්ත උඩින් ලියා නැත. අවසර ලත් පරිපාලකයෙකු සමඟ සමාලෝචනයට මෙම ටැබය තබන්න.",
    discard: "ඉඩම් කෙටුම්පත අත්හරින්න",
    discarding: "කෙටුම්පතේ ගිණුම පරීක්ෂා කරමින්…",
    discardConfirm:
      "මෙම ටැබයේ ඉඩම් අගයන් සහ නොවෙනස් ඉල්ලීම අත්හරින්නද? සේවාදායකය ඉල්ලීම දැනටමත් පිළිගෙන තිබිය හැකි අතර මෙයින් එය අවලංගු නොවේ. එම ඉඩම නැවත සටහන් කිරීමට පෙර අවසර ලත් පරිපාලකයෙකු සමඟ අවිනිශ්චිත ප්‍රතිඵලය පරීක්ෂා කරන්න.",
    saved: "ඉඩම් හඳුනාගැනීම පිළිගන්නා ලදී. වත්මන් කියවීමේ අවසර සමඟ ලේඛනය නැවුම් කරමින් පවතී.",
  },
} as const;
