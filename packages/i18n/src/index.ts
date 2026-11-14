export const copy = {
  en: {
    title: "Field officer workspace",
    description:
      "Register farmers and land after the offline prototype passes device testing.",
    warning: "This scaffold does not yet save data offline.",
    step: "Next: farmer registration & synchronization",
  },
  si: {
    title: "ක්ෂේත්‍ර නිලධාරී වැඩපොළ",
    description: "නොබැඳි පරීක්ෂණ සාර්ථක වූ පසු ගොවි සහ ඉඩම් ලියාපදිංචිය මෙතැනින් සිදු කළ හැක.",
    warning: "මෙම මුල් සංස්කරණයේ නොබැඳි දත්ත සුරැකීම තවම ක්‍රියාත්මක නොවේ.",
    step: "ඊළඟ පියවර: ගොවි ලියාපදිංචිය හා සමමුහුර්ත කිරීම",
  },
};

export type Language = keyof typeof copy;
