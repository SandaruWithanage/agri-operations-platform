import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agri Operations Field",
    short_name: "Agri Field",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#16724e",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
