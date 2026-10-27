import "reflect-metadata";
jest.mock("../../packaging/services/packaging.service", () => ({ packagingService: { createPackaging: jest.fn(async input => ({ id: 5, ...input })) } }));
import { packagingService } from "../../packaging/services/packaging.service";
import { genericPackagingController } from "./genericPackaging.controller";

const call = async (body: Record<string, unknown>) => {
    const json = jest.fn(), next = jest.fn();
    await genericPackagingController.material({ body, t: (key: string) => key } as never, { status: () => ({ json }) } as never, next);
    return { json, next };
};

it("creates generic materials through the packaging service, which assigns the code and the catalog consumption", async () => {
    const { next } = await call({ displayName: "Stretch", displayNameEn: "Stretch", unitCost: 0.02, packagingRole: "pallet", classification: "generic", materialType: "STRETCH" });
    expect(next).not.toHaveBeenCalled();
    const input = (packagingService.createPackaging as jest.Mock).mock.calls[0][0];
    expect(input).toMatchObject({ classification: "generic", materialType: "STRETCH" });
    expect(input).not.toHaveProperty("code");
});
it("rejects specific materials", async () => {
    (packagingService.createPackaging as jest.Mock).mockClear();
    const { next } = await call({ displayName: "Caja", displayNameEn: "Box", unitCost: 1, packagingRole: "pallet", classification: "specific" });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    expect(packagingService.createPackaging).not.toHaveBeenCalled();
});
