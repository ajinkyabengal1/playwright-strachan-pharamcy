import { Page, Locator } from "@playwright/test";

export class HomePage {
  readonly page: Page;
  readonly exploreServicesButton: Locator;
  readonly privateClinicsButton: Locator;
  readonly nhsServicesSection: Locator;
  readonly privateServicesSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.exploreServicesButton = page.getByRole("button", { name: "Explore Services" });
    this.privateClinicsButton = page.getByRole("button", { name: "Private Clinics" });
    this.nhsServicesSection = page.locator("#nhs-services");
    this.privateServicesSection = page.locator("#private-services");
  }

  async goto() {
    await this.page.goto("/");
  }

  async clickExploreServices() {
    await this.exploreServicesButton.click();
  }

  async clickPrivateClinics() {
    await this.privateClinicsButton.click();
  }

  async selectNhsService(serviceName: string) {
    await this.nhsServicesSection.getByRole("link", { name: serviceName }).click();
  }

  async selectPrivateService(serviceName: string) {
    await this.privateServicesSection.getByRole("link", { name: serviceName }).click();
  }
}
