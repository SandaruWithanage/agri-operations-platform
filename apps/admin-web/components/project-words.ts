export const projectWords = {
  en: {
    tab: "Projects",
    title: "Project catalog",
    scope:
      "Only projects allowed by your current organization-wide catalog read permissions are shown. Catalog access does not grant farmer, land or enrollment access.",
    name: "Project name",
    organization: "Organization",
    enabled: "Enabled in catalog",
    disabled: "Disabled in catalog",
    created: "Created",
    detail: "View project",
    close: "Close project",
    next: "Next page",
    back: "Previous page",
    empty:
      "No projects are available within your current catalog read permissions.",
    missing:
      "This project is not available within your current catalog read permissions.",
    notice:
      "A catalog entry does not enroll farmers, assign officers, create cultivation cycles or authorize a project workflow.",
  },
  si: {
    tab: "ව්‍යාපෘති",
    title: "ව්‍යාපෘති නාමාවලිය",
    scope:
      "වත්මන් ආයතන මට්ටමේ නාමාවලි කියවීමේ අවසර යටතේ ඇති ව්‍යාපෘති පමණක් පෙන්වයි. නාමාවලි අවසරය ගොවි, ඉඩම් හෝ ව්‍යාපෘති ඇතුළත් කිරීමේ අවසර ලබා නොදේ.",
    name: "ව්‍යාපෘති නම",
    organization: "ආයතනය",
    enabled: "නාමාවලියේ සක්‍රියයි",
    disabled: "නාමාවලියේ අක්‍රියයි",
    created: "සාදන ලදී",
    detail: "ව්‍යාපෘතිය බලන්න",
    close: "ව්‍යාපෘතිය වසන්න",
    next: "ඊළඟ පිටුව",
    back: "පෙර පිටුව",
    empty: "වත්මන් නාමාවලි කියවීමේ අවසර යටතේ ව්‍යාපෘති නොමැත.",
    missing: "වත්මන් නාමාවලි කියවීමේ අවසර යටතේ මෙම ව්‍යාපෘතිය ලබාගත නොහැක.",
    notice:
      "නාමාවලි සටහනක් ගොවීන් ඇතුළත් කිරීම, නිලධාරීන් පැවරීම, වගා චක්‍ර සෑදීම හෝ ව්‍යාපෘති කාර්ය ප්‍රවාහයකට අවසර දීම සිදු නොකරයි.",
  },
} as const;
export const projectCreationWords = {
  en: {
    start: "Create catalog project",
    title: "Online project creation",
    notice:
      "This online form keeps values and retry IDs only in this tab. Closing, reloading or a browser crash can lose them. Keep the tab open until the server confirms the result.",
    rules:
      "Choose a configured organization and enter a project name. New catalog entries default to disabled unless you explicitly enable them. This provisional catalog flag does not grant access, enroll farmers or launch a project workflow. Read permission is separate from creation.",
    locked: "Project draft locked",
    retained:
      "The draft or fixed submission remains in this tab. Check current access with the original account and approved device to reopen it.",
    resume: "Check access and reopen project",
    loading: "Checking project-create access…",
    unavailable:
      "Project access could not be confirmed. Values remain hidden. Check your sign-in, approved device, connection and organization-wide create permission.",
    fixed:
      "Retry this fixed request unchanged to confirm an uncertain result. Do not create another project for the same submission.",
    conflict:
      "The request conflicts with an existing submission. Nothing was overwritten. Keep this tab for review with an authorized administrator.",
    discard: "Discard project draft",
    discarding: "Checking the draft account…",
    discardConfirm:
      "Discard this tab's project values and retained request? The server may already have accepted it; discarding cannot undo that request. Check an uncertain outcome with an authorized administrator before creating the project again.",
    saved:
      "Project catalog entry accepted. The catalog is being refreshed with current read permissions.",
  },
  si: {
    start: "නාමාවලි ව්‍යාපෘතියක් සාදන්න",
    title: "මාර්ගගත ව්‍යාපෘති සෑදීම",
    notice:
      "මෙම මාර්ගගත පෝරමයේ අගයන් සහ නැවත උත්සාහ හැඳුනුම් මෙම ටැබයේ පමණක් පවතී. වැසීමෙන්, නැවත පූරණය කිරීමෙන් හෝ බ්‍රවුසරය බිඳවැටීමෙන් ඒවා නැති විය හැක. සේවාදායකය ප්‍රතිඵලය තහවුරු කරන තුරු ටැබය විවෘතව තබන්න.",
    rules:
      "සකසා ඇති ආයතනයක් තෝරා ව්‍යාපෘති නමක් ඇතුළත් කරන්න. ඔබ පැහැදිලිව සක්‍රිය කළහොත් හැර නව නාමාවලි සටහන් අක්‍රියව සෑදේ. මෙම තාවකාලික නාමාවලි සලකුණ අවසර ලබා දීමක්, ගොවීන් ඇතුළත් කිරීමක් හෝ ව්‍යාපෘති කාර්ය ප්‍රවාහයක් ආරම්භ කිරීමක් සිදු නොකරයි. කියවීමේ අවසරය සෑදීමේ අවසරයෙන් වෙන්ව පවතී.",
    locked: "ව්‍යාපෘති කෙටුම්පත අගුළු දමා ඇත",
    retained:
      "කෙටුම්පත හෝ නොවෙනස් ඉල්ලීම මෙම ටැබයේ පවතී. මුල් ගිණුම සහ අනුමත උපාංගයෙන් වත්මන් අවසර පරීක්ෂා කර නැවත විවෘත කරන්න.",
    resume: "අවසර පරීක්ෂා කර ව්‍යාපෘතිය නැවත විවෘත කරන්න",
    loading: "ව්‍යාපෘති සෑදීමේ අවසර පරීක්ෂා කරමින්…",
    unavailable:
      "ව්‍යාපෘති අවසර තහවුරු කළ නොහැකි විය. අගයන් සඟවා ඇත. පිවිසුම, අනුමත උපාංගය, සම්බන්ධතාවය සහ ආයතන මට්ටමේ සෑදීමේ අවසරය පරීක්ෂා කරන්න.",
    fixed:
      "අවිනිශ්චිත ප්‍රතිඵලය තහවුරු කිරීමට නොවෙනස් ඉල්ලීමම නැවත උත්සාහ කරන්න. එම යැවීම සඳහා තවත් ව්‍යාපෘතියක් සාදන්න එපා.",
    conflict:
      "ඉල්ලීම පවතින යැවීමක් සමඟ ගැටේ. දත්ත උඩින් ලියා නැත. අවසර ලත් පරිපාලකයෙකු සමඟ සමාලෝචනයට මෙම ටැබය තබන්න.",
    discard: "ව්‍යාපෘති කෙටුම්පත අත්හරින්න",
    discarding: "කෙටුම්පතේ ගිණුම පරීක්ෂා කරමින්…",
    discardConfirm:
      "මෙම ටැබයේ ව්‍යාපෘති අගයන් සහ රඳවා ඇති ඉල්ලීම අත්හරින්නද? සේවාදායකය දැනටමත් එය පිළිගෙන තිබිය හැකි අතර මෙයින් එය අවලංගු නොවේ. නැවත ව්‍යාපෘතිය සෑදීමට පෙර අවසර ලත් පරිපාලකයෙකු සමඟ අවිනිශ්චිත ප්‍රතිඵලය පරීක්ෂා කරන්න.",
    saved:
      "ව්‍යාපෘති නාමාවලි සටහන පිළිගන්නා ලදී. වත්මන් කියවීමේ අවසර සමඟ නාමාවලිය නැවුම් කරමින් පවතී.",
  },
} as const;
