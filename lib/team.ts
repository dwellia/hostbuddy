/**
 * lib/team.ts
 *
 * Ryan handles Delta Dawn. Amanda handles LeGobi.
 * All texts come from the Dwellia Quo number.
 */

export interface TeamMember {
  name: string;
  phone: string;
  asanaUserId: string;
}

export interface Property {
  id: string;
  name: string;
  location: string;
  contactKey: string;
  asanaProjectId: string;
  asanaSectionId: string; // "New Tasks" section
}

export const TEAM: Record<string, TeamMember> = {
  ryan: {
    name: "Ryan",
    phone: process.env.RYAN_PHONE || "",
    asanaUserId: process.env.ASANA_USER_RYAN || "",
  },
  amanda: {
    name: "Amanda",
    phone: process.env.AMANDA_PHONE || "",
    asanaUserId: process.env.ASANA_USER_AMANDA || "",
  },
};

export const PROPERTIES: Record<string, Property> = {
  "delta-dawn": {
    id: "delta-dawn",
    name: "Delta Dawn Retreat",
    location: "Sevierville, TN",
    contactKey: "ryan",
    asanaProjectId: process.env.ASANA_PROJECT_DELTA_DAWN || "",
    asanaSectionId: "1202800056668818",
  },
  legobii: {
    id: "legobii",
    name: "LeGobi Villa",
    location: "Kissimmee, FL",
    contactKey: "amanda",
    asanaProjectId: process.env.ASANA_PROJECT_LEGOBII || "",
    asanaSectionId: "1204093776126081",
  },
};

// STR Tasks project — for non-housekeeper action items (guest requests, cleanliness, etc.)
export const STR_TASKS_PROJECT_GID = "1214955401068301";
export const STR_TASKS_JORDAN_SECTION_GID = "1214955401068304";
export const JORDAN_USER_GID = process.env.ASANA_USER_JORDAN || "1200027663054269";

export function getContact(propertyId: string): TeamMember | null {
  const property = PROPERTIES[propertyId];
  if (!property) return null;
  return TEAM[property.contactKey] || null;
}

export function buildTeamContext(): string {
  const lines: string[] = ["CONTACTS:"];
  for (const [key, member] of Object.entries(TEAM)) {
    lines.push(`  ${member.name} (key="${key}")`);
  }
  lines.push("\nPROPERTIES:");
  for (const [, prop] of Object.entries(PROPERTIES)) {
    const contact = TEAM[prop.contactKey];
    lines.push(`  ${prop.id}: "${prop.name}" in ${prop.location}, contact=${contact?.name}`);
  }
  return lines.join("\n");
}
