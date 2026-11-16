export const policyStatusLabels = {
  en: {
    draft: "Draft",
    "pending-review": "Pending review",
    verified: "Verified",
    inactive: "Inactive",
  },
  si: {
    draft: "කෙටුම්පත",
    "pending-review": "සමාලෝචනය බලාපොරොත්තුවෙන්",
    verified: "තහවුරු කළ",
    inactive: "අක්‍රීය",
  },
} as const;
export const enrollmentPolicyWords = {
  en: {
    start: "Manage enrollment policy",
    title: "Online enrollment policy",
    notice:
      "This online form keeps working values and retry IDs only in this tab. Closing, reloading or a browser crash can lose them. Keep the tab open until the result is confirmed.",
    rules:
      "Enrollment is denied for a project until an administrator enables a policy here. The policy only chooses which farmer registration statuses may be enrolled. It is a provisional setting, not a client-approved eligibility rule, and it never grants anyone permission to enroll farmers. Saving requires the separate enrollment-policy administrator permission and the reviewed version.",
    locked: "Enrollment policy locked",
    retained:
      "The working values or fixed request remain in this tab. Check current access with the original account and approved device to reopen them.",
    resume: "Check access and reopen enrollment policy",
    loading: "Checking current enrollment-policy access…",
    unavailable:
      "Current policy access could not be confirmed. Values remain hidden. Check your sign-in, approved device, connection and the enrollment-policy administrator permission.",
    fixed:
      "The submitted values and reviewed version are fixed. Retry the same request to confirm an uncertain result; do not start another edit for this submission.",
    conflict:
      "The policy changed or the request conflicts with an existing submission. Nothing was overwritten. Retain these values for review, or explicitly discard and start from the current policy. The editor never rebases automatically.",
    discard: "Discard policy edit",
    discarding: "Checking the draft account…",
    discardConfirm:
      "Discard this tab's policy edits and retained request? This cannot undo a request already accepted or still running on the server. Review the current policy with an authorized administrator before submitting another change if the outcome is uncertain.",
    saved:
      "Enrollment policy accepted. The project is being refreshed with current read permissions.",
    none: "No policy exists yet, so enrollment is denied for this project.",
    version: "Reviewed version",
    enabled: "Allow enrollment in this project",
    statuses: "Farmer statuses that may be enrolled",
    review: "I reviewed the enabled setting and the selected statuses.",
    submit: "Save enrollment policy",
    submitting: "Submitting enrollment policy…",
    invalid: "Choose at least one farmer status.",
    failed: "Could not confirm the policy change. Retry the same request.",
    project: "Project",
  },
  si: {
    start: "ඇතුළත් කිරීමේ ප්‍රතිපත්තිය කළමනාකරණය කරන්න",
    title: "මාර්ගගත ඇතුළත් කිරීමේ ප්‍රතිපත්තිය",
    notice:
      "මෙම මාර්ගගත පෝරමයේ අගයන් සහ නැවත උත්සාහ හැඳුනුම් මෙම ටැබයේ පමණක් පවතී. වැසීමෙන්, නැවත පූරණය කිරීමෙන් හෝ බ්‍රවුසරය බිඳවැටීමෙන් ඒවා නැති විය හැක. ප්‍රතිඵලය තහවුරු වන තුරු ටැබය විවෘතව තබන්න.",
    rules:
      "පරිපාලකයෙකු මෙහි ප්‍රතිපත්තියක් සක්‍රිය කරන තුරු ව්‍යාපෘතියක් සඳහා ඇතුළත් කිරීම ප්‍රතික්ෂේප වේ. ප්‍රතිපත්තිය තෝරන්නේ ඇතුළත් කළ හැකි ගොවි ලියාපදිංචි තත්ත්වයන් පමණි. එය තාවකාලික සැකසුමකි; අනුමත සුදුසුකම් නීතියක් නොවන අතර ගොවීන් ඇතුළත් කිරීමට කිසිවෙකුට අවසර ලබා නොදේ. සුරැකීමට වෙනම ඇතුළත් කිරීමේ ප්‍රතිපත්ති පරිපාලක අවසරය සහ සමාලෝචිත අනුවාදය අවශ්‍යයි.",
    locked: "ඇතුළත් කිරීමේ ප්‍රතිපත්තිය අගුළු දමා ඇත",
    retained:
      "අගයන් හෝ නොවෙනස් ඉල්ලීම මෙම ටැබයේ පවතී. මුල් ගිණුම සහ අනුමත උපාංගයෙන් වත්මන් අවසර පරීක්ෂා කර නැවත විවෘත කරන්න.",
    resume: "අවසර පරීක්ෂා කර ඇතුළත් කිරීමේ ප්‍රතිපත්තිය නැවත විවෘත කරන්න",
    loading: "වත්මන් ඇතුළත් කිරීමේ ප්‍රතිපත්ති අවසර පරීක්ෂා කරමින්…",
    unavailable:
      "වත්මන් ප්‍රතිපත්ති අවසර තහවුරු කළ නොහැකි විය. අගයන් සඟවා ඇත. පිවිසුම, අනුමත උපාංගය, සම්බන්ධතාවය සහ ඇතුළත් කිරීමේ ප්‍රතිපත්ති පරිපාලක අවසරය පරීක්ෂා කරන්න.",
    fixed:
      "යැවූ අගයන් සහ සමාලෝචිත අනුවාදය නොවෙනස්ව තබා ඇත. අවිනිශ්චිත ප්‍රතිඵලය තහවුරු කිරීමට එම ඉල්ලීමම නැවත උත්සාහ කරන්න; එම යැවීම සඳහා වෙනත් සංස්කරණයක් ආරම්භ නොකරන්න.",
    conflict:
      "ප්‍රතිපත්තිය වෙනස් වී ඇත හෝ ඉල්ලීම පවතින යැවීමක් සමඟ ගැටේ. දත්ත උඩින් ලියා නැත. සමාලෝචනයට අගයන් තබන්න, නැතහොත් පැහැදිලිව අත්හැර වත්මන් ප්‍රතිපත්තියෙන් නැවත ආරම්භ කරන්න. ස්වයංක්‍රීයව අනුවාදය මාරු නොකරයි.",
    discard: "ප්‍රතිපත්ති සංස්කරණය අත්හරින්න",
    discarding: "කෙටුම්පතේ ගිණුම පරීක්ෂා කරමින්…",
    discardConfirm:
      "මෙම ටැබයේ ප්‍රතිපත්ති සංස්කරණ සහ ඉල්ලීම අත්හරින්නද? සේවාදායකය පිළිගත් හෝ තවමත් ක්‍රියාත්මක ඉල්ලීමක් මෙයින් අවලංගු නොවේ. ප්‍රතිඵලය අවිනිශ්චිත නම් වෙනත් වෙනසක් යැවීමට පෙර අවසර ලත් පරිපාලකයෙකු සමඟ වත්මන් ප්‍රතිපත්තිය සමාලෝචනය කරන්න.",
    saved:
      "ඇතුළත් කිරීමේ ප්‍රතිපත්තිය පිළිගන්නා ලදී. වත්මන් කියවීමේ අවසර සමඟ ව්‍යාපෘතිය නැවුම් කරමින් පවතී.",
    none: "තවම ප්‍රතිපත්තියක් නොමැති බැවින් මෙම ව්‍යාපෘතිය සඳහා ඇතුළත් කිරීම ප්‍රතික්ෂේප වේ.",
    version: "සමාලෝචිත අනුවාදය",
    enabled: "මෙම ව්‍යාපෘතියේ ඇතුළත් කිරීමට ඉඩ දෙන්න",
    statuses: "ඇතුළත් කළ හැකි ගොවි තත්ත්වයන්",
    review: "සක්‍රිය සැකසුම සහ තෝරාගත් තත්ත්වයන් මම සමාලෝචනය කළෙමි.",
    submit: "ඇතුළත් කිරීමේ ප්‍රතිපත්තිය සුරකින්න",
    submitting: "ඇතුළත් කිරීමේ ප්‍රතිපත්තිය යවමින්…",
    invalid: "අවම වශයෙන් ගොවි තත්ත්වයක් තෝරන්න.",
    failed: "ප්‍රතිපත්ති වෙනස තහවුරු කළ නොහැකි විය. එම ඉල්ලීමම නැවත උත්සාහ කරන්න.",
    project: "ව්‍යාපෘතිය",
  },
} as const;
