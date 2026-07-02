import type { ProjectType } from "@prisma/client";

/**
 * Default milestones auto-created when a project of the given type is
 * created. The admin can rename, reorder, or delete them afterwards.
 */
export const milestoneTemplates: Record<
  ProjectType,
  { title: string; description: string }[]
> = {
  SHOPIFY: [
    { title: "Discovery & Planning", description: "Define project goals, requirements, and store architecture." },
    { title: "Store Setup & Configuration", description: "Set up the Shopify store, theme, and environment." },
    { title: "Design & Branding", description: "Create visual design, color palette, and brand assets." },
    { title: "Product & Category Pages", description: "Build product listings and collection pages." },
    { title: "Payment & Shipping Setup", description: "Configure payment gateways and shipping rates." },
    { title: "Testing & QA", description: "Test all functionality, cross-browser, and performance." },
    { title: "Launch", description: "Go live and monitor post-launch performance." },
  ],
  WORDPRESS: [
    { title: "Discovery & Planning", description: "Define project goals, sitemap, and content requirements." },
    { title: "Hosting & WordPress Setup", description: "Provision hosting, install WordPress, and configure basics." },
    { title: "Theme Design & Build", description: "Design and build the theme to match the brand." },
    { title: "Pages & Content", description: "Build out pages and load content." },
    { title: "Plugins & Integrations", description: "Install and configure required plugins and integrations." },
    { title: "Testing & QA", description: "Test all functionality, cross-browser, and performance." },
    { title: "Launch", description: "Go live and monitor post-launch performance." },
  ],
  WEBFLOW: [
    { title: "Discovery & Planning", description: "Define project goals, requirements, and page inventory." },
    { title: "Sitemap & Wireframes", description: "Map the structure and wireframe key pages." },
    { title: "Visual Design", description: "Design high-fidelity pages in the brand style." },
    { title: "Webflow Build & CMS", description: "Build the site in Webflow and set up CMS collections." },
    { title: "Interactions & Responsive", description: "Add interactions and polish responsive breakpoints." },
    { title: "Testing & QA", description: "Test all functionality, cross-browser, and performance." },
    { title: "Launch", description: "Connect the domain, go live, and monitor." },
  ],
  CUSTOM_WEB_DEV: [
    { title: "Discovery & Requirements", description: "Gather requirements and define the project scope." },
    { title: "Technical Architecture", description: "Choose the stack and design the system architecture." },
    { title: "UI Design", description: "Design the interface and user flows." },
    { title: "Frontend Development", description: "Build the client-side application." },
    { title: "Backend & Database", description: "Build the server, APIs, and data layer." },
    { title: "Testing & QA", description: "Automated and manual testing across the stack." },
    { title: "Deployment & Launch", description: "Deploy to production and monitor." },
  ],
  APP_DEV: [
    { title: "Discovery & Requirements", description: "Define the product scope, platforms, and feature set." },
    { title: "UX/UI Design", description: "Design app screens and user experience." },
    { title: "Architecture & Project Setup", description: "Set up the codebase, CI, and core architecture." },
    { title: "Core Feature Development", description: "Build the main features of the app." },
    { title: "API & Integrations", description: "Connect backend services and third-party integrations." },
    { title: "Testing & Beta", description: "QA testing and beta distribution." },
    { title: "Store Submission & Launch", description: "Prepare store listings, submit, and launch." },
  ],
  UI_DESIGN_FIGMA: [
    { title: "Wireframing", description: "Low-fidelity structure and layout exploration." },
    { title: "First Draft", description: "High-fidelity first design draft in Figma." },
    { title: "Revisions", description: "Apply feedback rounds and refine the design." },
    { title: "Final Handoff", description: "Prepare final files, specs, and developer handoff." },
  ],
};

/** Tiptap-compatible doc for a plain paragraph of text. */
export function textToDoc(text: string) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  };
}
