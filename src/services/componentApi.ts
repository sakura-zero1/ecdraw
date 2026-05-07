import type { ComponentCategory, ElectricalComponent, ConnectivityMatrix, CategoryInfo } from '../types';
import { CATEGORIES } from '../constants/categories';
import { tauriRequest, ensureTauriAuth } from './tauriClient';

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
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiComponentWithVersion extends ApiComponent {
  latestVersion?: ApiComponentVersion;
}

function normalizeCategory(category: string): ComponentCategory {
  if (CATEGORIES.includes(category)) return category;
  return category || 'junctionPoint';
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

function toComponent(row: ApiComponentWithVersion): ElectricalComponent {
  const snapshot = row.latestVersion?.snapshot;
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
  const ok = await ensureTauriAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchComponentLibrary() {
  await requireAuth();
  const response = await tauriRequest<ApiComponentWithVersion[]>('list_components');
  const components = response.map(toComponent);
  const matrices = response.map((row) => toMatrix(row.id, row.latestVersion?.snapshot));
  return { components, matrices };
}

export async function createComponentByApi(name: string, category: ComponentCategory) {
  await requireAuth();
  const created = await tauriRequest<ApiComponent>('create_component', {
    name, category, description: '',
  });
  return toComponent({ ...created, latestVersion: { id: '', versionNo: 1, snapshot: {} } });
}

export async function duplicateComponentByApi(componentId: string) {
  await requireAuth();
  const created = await tauriRequest<ApiComponent>('duplicate_component', { id: componentId });
  const detail = await tauriRequest<ApiComponentWithVersion>('get_component', { id: created.id });
  return {
    component: toComponent(detail),
    matrix: toMatrix(detail.id, detail.latestVersion?.snapshot),
  };
}

export async function updateComponentMetaByApi(component: ElectricalComponent) {
  await requireAuth();
  await tauriRequest('update_component', {
    id: component.id,
    name: component.name,
    category: component.category,
    description: component.description,
  });
}

export async function deleteComponentByApi(componentId: string) {
  await requireAuth();
  await tauriRequest('delete_component', { id: componentId });
}

export async function saveComponentVersionByApi(component: ElectricalComponent, matrix: ConnectivityMatrix) {
  await requireAuth();
  await tauriRequest('create_component_version', {
    id: component.id,
    snapshot: buildSnapshot(component, matrix),
  });
}

export async function fetchCategories(): Promise<CategoryInfo[]> {
  await requireAuth();
  return tauriRequest<CategoryInfo[]>('list_categories');
}

export async function createCategory(name: string, label: string, color: string): Promise<CategoryInfo> {
  await requireAuth();
  return tauriRequest<CategoryInfo>('create_category', { name, label, color });
}

export async function deleteCategory(id: string): Promise<void> {
  await requireAuth();
  await tauriRequest('delete_category', { id });
}
