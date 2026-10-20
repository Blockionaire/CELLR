import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CELLR",
    short_name: "CELLR",
    description: "Your personal intelligent wine cellar.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // One colour for everyone here (the page's own theme-color follows light and dark): Noir's canvas, the same
    // dark as the app's own dark theme-color, so the splash hands over without a change of shade.
    background_color: "#0e090b",
    theme_color: "#0e090b",
    categories: ["food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [{ name: "Scan a bottle", short_name: "Scan", url: "/scan" }],
  };
}
