import "reflect-metadata";
import i18next from "i18next";
import type { Request } from "express";
import type Permission from "../models/Permission.model";
import { toPermissionResponse } from "./localizePermissionName";
import es from "../../../../locales/es/translation.json";
import en from "../../../../locales/en/translation.json";
it.each(["es", "en"])("M4 localizes all three generic permissions consumed by Roles (%s)", async lng => {
 const i18n = i18next.createInstance(); await i18n.init({lng, resources: {es:{translation:es},en:{translation:en}}});
 for (const action of ["view", "create", "edit"]) {
  const name = `genericPackaging:${action}`;
  const permission = {name, description: "internal", toJSON: () => ({name})} as Permission;
  const result = toPermissionResponse({t:i18n.t.bind(i18n)} as unknown as Request, permission);
  expect(result.description).toBe(`${i18n.t(`permissionActions.${action}`)} ${lng === "es" ? "Empaques genéricos" : "Generic packaging"}`);
 }
});
