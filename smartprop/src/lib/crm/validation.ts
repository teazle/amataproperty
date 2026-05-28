import { z } from 'zod';

export const crmLeadStatuses = [
  'new',
  'contacted',
  'qualified',
  'viewing_scheduled',
  'offer',
  'won',
  'lost',
] as const;

export const crmLeadPriorities = ['low', 'normal', 'high'] as const;

export const crmActivityTypes = [
  'created',
  'note',
  'call',
  'status_change',
  'follow_up_scheduled',
] as const;

export type CrmLeadStatus = (typeof crmLeadStatuses)[number];
export type CrmLeadPriority = (typeof crmLeadPriorities)[number];
export type CrmActivityType = (typeof crmActivityTypes)[number];

const trimmedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max);

export const crmPublicLeadSchema = z.object({
  projectSlug: trimmedString(1, 80)
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Invalid project slug'),
  propertyTitle: trimmedString(1, 160),
  sourcePath: trimmedString(1, 300),
  name: trimmedString(1, 100),
  phone: trimmedString(1, 30).regex(/^[0-9+\-\s()]+$/, 'Invalid phone number'),
  email: z.string().trim().toLowerCase().email().max(255),
  message: trimmedString(1, 1000),
  website: z.string().trim().max(0).optional().or(z.literal('')),
});

export const crmLeadUpdateSchema = z
  .object({
    status: z.enum(crmLeadStatuses).optional(),
    priority: z.enum(crmLeadPriorities).optional(),
    assignedTo: z.string().trim().max(100).nullable().optional(),
    followUpAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const crmActivityCreateSchema = z.object({
  type: z.enum(['note', 'call', 'follow_up_scheduled']),
  note: trimmedString(1, 1000),
  followUpAt: z.string().datetime().nullable().optional(),
});

export function isCrmLeadStatus(status: string): status is CrmLeadStatus {
  return crmLeadStatuses.includes(status as CrmLeadStatus);
}

export function formatCrmStatus(status: CrmLeadStatus) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
