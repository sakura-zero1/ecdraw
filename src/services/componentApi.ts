import type { ComponentCategory, ElectricalComponent, ConnectivityMatrix } from '../types';
import { CATEGORIES } from '../constants/categories';
import { apiRequest, ensureApiAuth } from './apiClient';

interface ApiComponentVersion {
  id: string;
  versionNo: number;
  snapshot: unknown;
}

interface ApiComponent {
  id: string;
  name: string;
  category: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  versions?: ApiComponentVersion[];
}

interface ApiListResponse<T> {
  items: T[];
}

function normalizeCategory(category: string): ComponentCategory {
  if (CATEGORIES.includes(category as ComponentCategory)) {
    return category as ComponentCategory;
  }
  return 'junctionPoint';
}

function toMatrix(componentId: string, snapshot: unknown): ConnectivityMatrix {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const matrix = (snapshot as { matrix?: { connections?: unknown } }).matrix;
    if (matrix && typeof matrix === 'object' && Array.isArray(matrix.connections)) {
      return { componentId, connections: matrix.connections as ConnectivityMatrix['connections'] };
    }
  }
  return { componentId, connections: [] };
}

function toComponent(row: ApiComponent): ElectricalComponent {
  const snapshot = row.versions?.[0]?.snapshot;
  const fallbackWidth = 1200;
  const fallbackHeight = 800;
  const payload = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? (snapshot as {
        width?: number;
        height?: number;
        displayWidth?: number;
        displayHeight?: number;
        shapeElements?: ElectricalComponent['shapeElements'];
        pins?: ElectricalComponent['pins'];
      })
    : undefined;

  return {
    id: row.id,
    name: row.name,
    category: normalizeCategory(row.category),
    description: row.description ?? '',
    width: Number(payload?.width) > 0 ? Number(payload?.width) : fallbackWidth,
    height: Number(payload?.height) > 0 ? Number(payload?.height) : fallbackHeight,
    displayWidth: Number(payload?.displayWidth) > 0 ? Number(payload?.displayWidth) : 140,
    displayHeight: Number(payload?.displayHeight) > 0 ? Number(payload?.displayHeight) : 90,
    shapeElements: Array.isArray(payload?.shapeElements) ? payload.shapeElements : [],
    pins: Array.isArray(payload?.pins) ? payload.pins : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildSnapshot(component: ElectricalComponent, matrix: ConnectivityMatrix) {
  return {
    schemaVersion: 1,
    width: component.width,
    height: component.height,
    displayWidth: component.displayWidth,
    displayHeight: component.displayHeight,
    shapeElements: component.shapeElements,
    pins: component.pins,
    matrix,
  };
}

async function requireAuth() {
  const ok = await ensureApiAuth();
  if (!ok) {
    throw new Error('未登录，无法访问 API');
  }
}

export async function fetchComponentLibrary() {
  await requireAuth();
  const response = await apiRequest<ApiListResponse<ApiComponent>>('/api/components');
  const components = response.items.map(toComponent);
  const matrices = response.items.map((row) => toMatrix(row.id, row.versions?.[0]?.snapshot));
  return { components, matrices };
}

export async function createComponentByApi(name: string, category: ComponentCategory) {
  await requireAuth();
  const created = await apiRequest<ApiComponent>('/api/components', {
    method: 'POST',
    body: { name, category, description: '', isPublic: false },
  });

  return toComponent({ ...created, versions: [{ id: '', versionNo: 1, snapshot: {} }] });
}

export async function duplicateComponentByApi(componentId: string) {
  await requireAuth();
  const created = await apiRequest<ApiComponent>(`/api/components/${componentId}/duplicate`, {
    method: 'POST',
  });
  const detail = await apiRequest<ApiComponent>(`/api/components/${created.id}`);
  return {
    component: toComponent(detail),
    matrix: toMatrix(detail.id, detail.versions?.[0]?.snapshot),
  };
}

export async function updateComponentMetaByApi(component: ElectricalComponent) {
  await requireAuth();
  await apiRequest<ApiComponent>(`/api/components/${component.id}`, {
    method: 'PATCH',
    body: {
      name: component.name,
      category: component.category,
      description: component.description,
    },
  });
}

export async function deleteComponentByApi(componentId: string) {
  await requireAuth();
  await apiRequest(`/api/components/${componentId}`, { method: 'DELETE' });
}

export async function saveComponentVersionByApi(component: ElectricalComponent, matrix: ConnectivityMatrix) {
  await requireAuth();
  await apiRequest(`/api/components/${component.id}/versions`, {
    method: 'POST',
    body: {
      snapshot: buildSnapshot(component, matrix),
    },
  });
}

