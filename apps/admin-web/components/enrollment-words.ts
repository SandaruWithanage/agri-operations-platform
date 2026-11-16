export const enrollmentWords = {
  en: {
    tab: "Enrollments",
    title: "Project enrollments",
    scope:
      "Only enrollments you may read in the project's scope and for farmers you may currently see are shown. A project catalog entry or a farmer record never enrolls anyone.",
    notice:
      "Enrollment rules are provisional and not client-approved. A project accepts enrollments only while an administrator has enabled its enrollment policy.",
    empty: "No enrollments are available within your current permissions.",
    missing:
      "This enrollment is not available within your current permissions.",
    project: "Project reference",
    farmer: "Farmer reference",
    status: "Status",
    enrolled: "Enrolled",
    withdrawn: "Withdrawn",
    enrolledAt: "Enrolled on",
    withdrawnAt: "Withdrawn on",
    version: "Record version",
    detail: "View enrollment",
    close: "Close enrollment",
    next: "Next page",
    back: "Previous page",
    references:
      "References are record identifiers only. Names are not repeated here so this view never reveals a project or farmer you cannot read.",
  },
  si: {
    tab: "ඇතුළත් කිරීම්",
    title: "ව්‍යාපෘති ඇතුළත් කිරීම්",
    scope:
      "ව්‍යාපෘතියේ විෂය පථය තුළ ඔබට කියවිය හැකි සහ ඔබට දැනට දැකිය හැකි ගොවීන් සඳහා වන ඇතුළත් කිරීම් පමණක් පෙන්වයි. ව්‍යාපෘති නාමාවලි සටහනක් හෝ ගොවි වාර්තාවක් කිසිවෙකු ඇතුළත් නොකරයි.",
    notice:
      "ඇතුළත් කිරීමේ නීති තාවකාලික වන අතර ගනුදෙනුකරු අනුමත නොකළ ඒවාය. පරිපාලකයෙකු ව්‍යාපෘතියේ ඇතුළත් කිරීමේ ප්‍රතිපත්තිය සක්‍රිය කර ඇති තාක් පමණක් ව්‍යාපෘතියක් ඇතුළත් කිරීම් පිළිගනී.",
    empty: "වත්මන් අවසර යටතේ ඇතුළත් කිරීම් නොමැත.",
    missing: "වත්මන් අවසර යටතේ මෙම ඇතුළත් කිරීම ලබාගත නොහැක.",
    project: "ව්‍යාපෘති යොමුව",
    farmer: "ගොවි යොමුව",
    status: "තත්ත්වය",
    enrolled: "ඇතුළත් කර ඇත",
    withdrawn: "ඉවත් කර ඇත",
    enrolledAt: "ඇතුළත් කළ දිනය",
    withdrawnAt: "ඉවත් කළ දිනය",
    version: "වාර්තා අනුවාදය",
    detail: "ඇතුළත් කිරීම බලන්න",
    close: "ඇතුළත් කිරීම වසන්න",
    next: "ඊළඟ පිටුව",
    back: "පෙර පිටුව",
    references:
      "යොමු යනු වාර්තා හඳුනාගැනීම් පමණි. ඔබට කියවිය නොහැකි ව්‍යාපෘතියක් හෝ ගොවියෙකු මෙම දසුනෙන් හෙළි නොවීමට නම් මෙහි නොපෙන්වයි.",
  },
} as const;
export const enrollmentWithdrawWords = {
  en: {
    start: "Withdraw enrollment",
    title: "Online enrollment withdrawal",
    notice:
      "This online form keeps the retry ID only in this tab. Closing, reloading or a browser crash can lose it. Keep the tab open until the result is confirmed.",
    rules:
      "Withdrawing ends this enrollment and keeps it as history. It cannot be reopened; enrolling again creates a new record. Saving requires the separate withdrawal permission and the reviewed record version.",
    locked: "Enrollment withdrawal locked",
    retained:
      "The fixed request remains in this tab. Check current access with the original account and approved device to reopen it.",
    resume: "Check access and reopen enrollment withdrawal",
    loading: "Checking current enrollment access…",
    unavailable:
      "Current enrollment access could not be confirmed. Details remain hidden. Check your sign-in, approved device, connection and permissions.",
    fixed:
      "The reviewed version is fixed. Retry the same request to confirm an uncertain result; do not start another withdrawal for this submission.",
    conflict:
      "The enrollment changed, was already withdrawn or the request conflicts with an existing submission. Nothing was overwritten. Discard and review the current record.",
    discard: "Discard withdrawal",
    discarding: "Checking the draft account…",
    discardConfirm:
      "Discard this tab's withdrawal request? This cannot undo a request already accepted or still running on the server. Review the current enrollment before trying again if the outcome is uncertain.",
    saved:
      "Withdrawal accepted. The enrollment is being refreshed with current read permissions.",
    review: "I reviewed this enrollment and want to withdraw it.",
    submit: "Withdraw enrollment",
    submitting: "Submitting withdrawal…",
    failed: "Could not confirm the withdrawal. Retry the same request.",
    version: "Reviewed version",
    project: "Project reference",
    farmer: "Farmer reference",
  },
  si: {
    start: "ඇතුළත් කිරීම ඉවත් කරන්න",
    title: "මාර්ගගත ඇතුළත් කිරීම ඉවත් කිරීම",
    notice:
      "මෙම මාර්ගගත පෝරමයේ නැවත උත්සාහ හැඳුනුම මෙම ටැබයේ පමණක් පවතී. වැසීමෙන්, නැවත පූරණය කිරීමෙන් හෝ බ්‍රවුසරය බිඳවැටීමෙන් එය නැති විය හැක. ප්‍රතිඵලය තහවුරු වන තුරු ටැබය විවෘතව තබන්න.",
    rules:
      "ඉවත් කිරීමෙන් මෙම ඇතුළත් කිරීම අවසන් වන අතර ඉතිහාසයක් ලෙස රැඳේ. එය නැවත විවෘත කළ නොහැක; නැවත ඇතුළත් කිරීමෙන් නව වාර්තාවක් සෑදේ. සුරැකීමට වෙනම ඉවත් කිරීමේ අවසරය සහ සමාලෝචිත වාර්තා අනුවාදය අවශ්‍යයි.",
    locked: "ඇතුළත් කිරීම ඉවත් කිරීම අගුළු දමා ඇත",
    retained:
      "නොවෙනස් ඉල්ලීම මෙම ටැබයේ පවතී. මුල් ගිණුම සහ අනුමත උපාංගයෙන් වත්මන් අවසර පරීක්ෂා කර නැවත විවෘත කරන්න.",
    resume: "අවසර පරීක්ෂා කර ඇතුළත් කිරීම ඉවත් කිරීම නැවත විවෘත කරන්න",
    loading: "වත්මන් ඇතුළත් කිරීමේ අවසර පරීක්ෂා කරමින්…",
    unavailable:
      "වත්මන් ඇතුළත් කිරීමේ අවසර තහවුරු කළ නොහැකි විය. විස්තර සඟවා ඇත. පිවිසුම, අනුමත උපාංගය, සම්බන්ධතාවය සහ අවසර පරීක්ෂා කරන්න.",
    fixed:
      "සමාලෝචිත අනුවාදය නොවෙනස්ව තබා ඇත. අවිනිශ්චිත ප්‍රතිඵලය තහවුරු කිරීමට එම ඉල්ලීමම නැවත උත්සාහ කරන්න; එම යැවීම සඳහා වෙනත් ඉවත් කිරීමක් ආරම්භ නොකරන්න.",
    conflict:
      "ඇතුළත් කිරීම වෙනස් වී ඇත, දැනටමත් ඉවත් කර ඇත, නැතහොත් ඉල්ලීම පවතින යැවීමක් සමඟ ගැටේ. දත්ත උඩින් ලියා නැත. අත්හැර වත්මන් වාර්තාව සමාලෝචනය කරන්න.",
    discard: "ඉවත් කිරීම අත්හරින්න",
    discarding: "කෙටුම්පතේ ගිණුම පරීක්ෂා කරමින්…",
    discardConfirm:
      "මෙම ටැබයේ ඉවත් කිරීමේ ඉල්ලීම අත්හරින්නද? සේවාදායකය පිළිගත් හෝ තවමත් ක්‍රියාත්මක ඉල්ලීමක් මෙයින් අවලංගු නොවේ. ප්‍රතිඵලය අවිනිශ්චිත නම් නැවත උත්සාහ කිරීමට පෙර වත්මන් ඇතුළත් කිරීම සමාලෝචනය කරන්න.",
    saved: "ඉවත් කිරීම පිළිගන්නා ලදී. වත්මන් කියවීමේ අවසර සමඟ ඇතුළත් කිරීම නැවුම් කරමින් පවතී.",
    review: "මම මෙම ඇතුළත් කිරීම සමාලෝචනය කර එය ඉවත් කිරීමට කැමැත්තෙමි.",
    submit: "ඇතුළත් කිරීම ඉවත් කරන්න",
    submitting: "ඉවත් කිරීම යවමින්…",
    failed: "ඉවත් කිරීම තහවුරු කළ නොහැකි විය. එම ඉල්ලීමම නැවත උත්සාහ කරන්න.",
    version: "සමාලෝචිත අනුවාදය",
    project: "ව්‍යාපෘති යොමුව",
    farmer: "ගොවි යොමුව",
  },
} as const;
