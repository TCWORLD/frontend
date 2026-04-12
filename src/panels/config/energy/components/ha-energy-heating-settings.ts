import { mdiDelete, mdiFire, mdiPencil, mdiPlus } from "@mdi/js";
import type { CSSResultGroup, TemplateResult } from "lit";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators";
import { fireEvent } from "../../../../common/dom/fire_event";
import "../../../../components/ha-button";
import "../../../../components/ha-card";
import "../../../../components/ha-icon-button";
import type {
  EnergyPreferences,
  EnergyPreferencesValidation,
  EnergyValidationIssue,
  HeatingSourceTypeEnergyPreference,
} from "../../../../data/energy";
import { saveEnergyPreferences } from "../../../../data/energy";
import type { StatisticsMetaData } from "../../../../data/recorder";
import { getStatisticLabel } from "../../../../data/recorder";
import {
  showAlertDialog,
  showConfirmationDialog,
} from "../../../../dialogs/generic/show-dialog-box";
import { haStyle } from "../../../../resources/styles";
import type { HomeAssistant } from "../../../../types";
import { documentationUrl } from "../../../../util/documentation-url";
import { showEnergySettingsHeatingDialog } from "../dialogs/show-dialogs-energy";
import "./ha-energy-validation-result";
import { energyCardStyles } from "./styles";

@customElement("ha-energy-heating-settings")
export class EnergyHeatingSettings extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false })
  public preferences!: EnergyPreferences;

  @property({ attribute: false })
  public statsMetadata?: Record<string, StatisticsMetaData>;

  @property({ attribute: false })
  public validationResult?: EnergyPreferencesValidation;

  protected render(): TemplateResult {
    const heatingSources: HeatingSourceTypeEnergyPreference[] = [];
    const heatingValidation: EnergyValidationIssue[][] = [];

    this.preferences.energy_sources.forEach((source, idx) => {
      if (source.type !== "heating") {
        return;
      }
      heatingSources.push(source);

      if (this.validationResult) {
        heatingValidation.push(this.validationResult.energy_sources[idx]);
      }
    });

    return html`
      <ha-card>
        <h1 class="card-header">
          <ha-svg-icon .path=${mdiFire}></ha-svg-icon>
          ${this.hass.localize("ui.panel.config.energy.heating.title")}
        </h1>

        <div class="card-content">
          <p>
            ${this.hass.localize("ui.panel.config.energy.heating.sub")}
            <a
              target="_blank"
              rel="noopener noreferrer"
              href=${documentationUrl(this.hass, "/docs/energy/heating/")}
              >${this.hass.localize(
                "ui.panel.config.energy.heating.learn_more"
              )}</a
            >
          </p>
          ${heatingValidation.map(
            (result) => html`
              <ha-energy-validation-result
                .hass=${this.hass}
                .issues=${result}
              ></ha-energy-validation-result>
            `
          )}
          ${heatingSources.length > 0
            ? html`
                <div class="items-container">
                  ${heatingSources.map((source) => {
                    const entityState =
                      this.hass.states[source.stat_energy_from];
                    return html`
                      <div class="row" .source=${source}>
                        ${entityState?.attributes.icon
                          ? html`<ha-icon
                              .icon=${entityState.attributes.icon}
                            ></ha-icon>`
                          : html`<ha-svg-icon .path=${mdiFire}></ha-svg-icon>`}
                        <span class="content"
                          >${getStatisticLabel(
                            this.hass,
                            source.stat_energy_from,
                            this.statsMetadata?.[source.stat_energy_from]
                          )}</span
                        >
                        <ha-icon-button
                          .label=${this.hass.localize(
                            "ui.panel.config.energy.heating.edit_heating_source"
                          )}
                          @click=${this._editSource}
                          .path=${mdiPencil}
                        ></ha-icon-button>
                        <ha-icon-button
                          .label=${this.hass.localize(
                            "ui.panel.config.energy.heating.delete_heating_source"
                          )}
                          @click=${this._deleteSource}
                          .path=${mdiDelete}
                        ></ha-icon-button>
                      </div>
                    `;
                  })}
                </div>
              `
            : ""}
          <div class="row">
            <ha-button
              @click=${this._addSource}
              appearance="filled"
              size="small"
            >
              <ha-svg-icon slot="start" .path=${mdiPlus}></ha-svg-icon
              >${this.hass.localize(
                "ui.panel.config.energy.heating.add_heating_source"
              )}</ha-button
            >
          </div>
        </div>
      </ha-card>
    `;
  }

  private _addSource() {
    showEnergySettingsHeatingDialog(this, {
      heating_sources: this.preferences.energy_sources.filter(
        (src) => src.type === "heating"
      ) as HeatingSourceTypeEnergyPreference[],
      saveCallback: async (source) => {
        await this._savePreferences({
          ...this.preferences,
          energy_sources: this.preferences.energy_sources.concat(source),
        });
      },
    });
  }

  private _editSource(ev) {
    const origSource: HeatingSourceTypeEnergyPreference =
      ev.currentTarget.closest(".row").source;
    showEnergySettingsHeatingDialog(this, {
      source: { ...origSource },
      metadata: this.statsMetadata?.[origSource.stat_energy_from],
      heating_sources: this.preferences.energy_sources.filter(
        (src) => src.type === "heating"
      ) as HeatingSourceTypeEnergyPreference[],
      saveCallback: async (newSource) => {
        await this._savePreferences({
          ...this.preferences,
          energy_sources: this.preferences.energy_sources.map((src) =>
            src === origSource ? newSource : src
          ),
        });
      },
    });
  }

  private async _deleteSource(ev) {
    const sourceToDelete: HeatingSourceTypeEnergyPreference =
      ev.currentTarget.closest(".row").source;

    if (
      !(await showConfirmationDialog(this, {
        title: this.hass.localize("ui.panel.config.energy.delete_source"),
      }))
    ) {
      return;
    }

    try {
      await this._savePreferences({
        ...this.preferences,
        energy_sources: this.preferences.energy_sources.filter(
          (source) => source !== sourceToDelete
        ),
      });
    } catch (err: any) {
      showAlertDialog(this, { title: `Failed to save config: ${err.message}` });
    }
  }

  private async _savePreferences(preferences: EnergyPreferences) {
    const result = await saveEnergyPreferences(this.hass, preferences);
    fireEvent(this, "value-changed", { value: result });
  }

  static get styles(): CSSResultGroup {
    return [haStyle, energyCardStyles];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-energy-heating-settings": EnergyHeatingSettings;
  }
}
