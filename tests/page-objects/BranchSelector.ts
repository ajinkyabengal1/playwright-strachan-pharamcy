import { Page } from "@playwright/test";

export class BranchSelector {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Select a preferred pharmacy branch (if multiple are available).
   * First clicks "Change" to reveal options, then picks the target branch.
   */
  async selectBranch(branchName: string) {
    // Check if the branch is already selected
    const currentBranchEl = this.page.locator('div:has(> span:text-is("Your branch")) + p').first();
    // In the provided HTML: <div class="min-w-0 flex-1">...<p class="text-[0.95rem] text-gray-900 truncate" style="font-weight: 700;">strachans-one</p>
    // A more reliable way based on the snippet:
    const currentBranchName = await this.page.locator('p[style*="font-weight: 700"]').first().textContent().catch(() => "");
    
    if (currentBranchName?.trim().toLowerCase() === branchName.toLowerCase()) {
      console.log(`[BranchSelector] Branch "${branchName}" is already selected`);
      return;
    }

    const changeBtn = this.page.getByRole("button", { name: "Change" }).first();
    
    if (await changeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log(`[BranchSelector] Clicking Change button to select branch: ${branchName}`);
      await changeBtn.click();
      await this.page.waitForTimeout(800);

      // Find the branch button. The HTML shows buttons with branch names inside spans.
      const branchOption = this.page.locator('button').filter({ hasText: new RegExp(`^${branchName}$`, 'i') }).first();
      
      // Fallback if exact match fails (e.g. text is inside a span)
      const branchOptionFallback = this.page.locator('button').filter({ has: this.page.locator('span').filter({ hasText: new RegExp(`^${branchName}$`, 'i') }) }).first();

      const finalOption = (await branchOption.isVisible().catch(() => false)) ? branchOption : branchOptionFallback;

      if (await finalOption.isVisible().catch(() => false)) {
        console.log(`[BranchSelector] Selecting branch: ${branchName}`);
        await finalOption.click();
        await this.page.waitForTimeout(1000);
      } else {
        console.log(`[BranchSelector] Branch option "${branchName}" not found`);
      }
    } else {
      console.log("[BranchSelector] Change branch button not visible - skipping branch selection");
    }
  }
}
