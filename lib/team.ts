/**
 * lib/team.ts
 *
 * Single source of truth for who's on the team and what they do.
 * When someone joins or leaves, update this file only.
 */

export interface TeamMember {
  name: string;
  role: "owner" | "tech";
  phone: string; // E.164 format — must match env var value
  asanaUserId: string; // Asana user GID
  specialties: string[]; // used by Claude to match issue types
}

export interface Property {
  id: string;
  name: string;
  location: string;
  ownerKey: string; // key into TEAM that is the primary owner
  asanaProjectId: string;
}

// ── Team ──────────────────────────────────────────────────────────────────────
export const TEAM: Record<string, TeamMember> = {
  john: {
    name: "John",
    role: "owner",
    phone: process.env.OWNER_JOHN_PHONE || "",
    asanaUserId: process.env.ASANA_USER_JOHN || "",
    specialties: ["guest_complaint", "safety_alert", "pool_equipment", "general"],
  },
  sarah: {
    name: "Sarah",
    role: "owner",
    phone: process.env.OWNER_SARAH_PHONE || "",
    asanaUserId: process.env.ASANA_USER_SARAH || "",
    specialties: ["guest_complaint", "safety_alert", "general"],
  },
  mike: {
    name: "Mike",
    role: "tech",
    phone: process.env.TECH_MIKE_PHONE || "",
    asanaUserId: process.env.ASANA_USER_MIKE || "",
    specialties: ["hvac", "pool_equipment", "plumbing", "appliances"],
  },
  carlos: {
    name: "Carlos",
    role: "tech",
    phone: process.env.TECH_CARLOS_PHONE || "",
    asanaUserId: process.env.ASANA_USER_CARLOS || "",
    specialties: ["electrical", "wifi", "entertainment_system", "appliances"],
  },
};

// ── Properties ────────────────────────────────────────────────────────────────
export const PROPERTIES: Record<string, Property> = {
  "delta-dawn": {
    id: "delta-dawn",
    name: "Delta Dawn Retreat",
    location: "Sevierville, TN",
    ownerKey: "john",
    asanaProjectId: process.env.ASANA_PROJECT_DELTA_DAWN || "",
  },
  legobii: {
    id: "legobii",
    name: "LeGobi Villa",
    location: "Kissimmee, FL",
    ownerKey: "sarah",
    asanaProjectId: process.env.ASANA_PROJECT_LEGOBII || "",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get the owner for a property */
export function getOwner(propertyId: string): TeamMember | null {
  const property = PROPERTIES[propertyId];
  if (!property) return null;
  return TEAM[property.ownerKey] || null;
}

/** Format team context string for Claude's prompt */
export function buildTeamContext(): string {
  const lines: string[] = ["TEAM:"];
  for (const [key, member] of Object.entries(TEAM)) {
    lines.push(
      `  ${member.name} (${member.role}, key="${key}"): specialties=[${member.specialties.join(", ")}]`
    );
  }
  lines.push("\nPROPERTIES:");
  for (const [, prop] of Object.entries(PROPERTIES)) {
    const owner = TEAM[prop.ownerKey];
    lines.push(
      `  ${prop.id}: "${prop.name}" in ${prop.location}, owner=${owner?.name}`
    );
  }
  return lines.join("\n");
}
