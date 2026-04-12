import type { CSSResultGroup } from "lit";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { fireEvent } from "../../../../common/dom/fire_event";
import "../../../../components/entity/ha-entity-picker";
import "../../../../components/entity/ha-statistic-picker";
import "../../../../components/ha-button";
import "../../../../components/ha-dialog-footer";
import "../../../../components/ha-formfield";
import "../../../../components/ha-radio";
import "../../../../components/ha-markdown";
import "../../../../components/ha-dialog";
import type { HaRadio } from "../../../../components/ha-radio";
import "../../../../components/input/ha-input";
import type { HeatingSourceTypeEnergyPreference } from "../../../../data/energy";
import {
  emptyHeatingEnergyPreference,
  energyStatisticHelpUrl,
} from "../../../../data/energy";
import { isExternalStatistic } from "../../../../data/recorder";
import { getSensorDeviceClassConvertibleUnits } from "../../../../data/sensor";
import type { HassDialog } from "../../../../dialogs/make-dialog-manager";
import { haStyle, haStyleDialog } from "../../../../resources/styles";
import type { HomeAssistant, ValueChangedEvent } from "../../../../types";
import type { EnergySettingsHeatingDialogParams } from "./show-dialogs-energy";

const energyUnitClasses = ["energy"];

@customElement("dialog-energy-heating-settings")
export class DialogEnergyHeatingSettings
  extends LitElement
  implements HassDialog<EnergySettingsHeatingDialogParams>
{
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _params?: EnergySettingsHeatingDialogParams;

  @state() private _open = false;

  @state() private _source?: HeatingSourceTypeEnergyPreference;

  @state() private _costs?: "no-costs" | "number" | "entity" | "statistic";

  @state() private _energy_units?: string[];

  @state() private _error?: string;

  private _excludeList?: string[];

  public async showDialog(
    params: EnergySettingsHeatingDialogParams
  ): Promise<void> {
    this._params = params;
    this._source = params.source
      ? { ...params.source }
      : emptyHeatingEnergyPreference();
    this._costs = this._source.entity_energy_price
      ? "entity"
      : this._source.number_energy_price
        ? "number"
        : this._source.stat_cost
          ? "statistic"
          : "no-costs";
    this._energy_units = (
      await getSensorDeviceClassConvertibleUnits(this.hass, "energy")
    ).units;

    // Build energy exclude list
    const allSources: string[] = [];
    this._params.heating_sources.forEach((entry) => {
      if (entry.stat_energy_from) allSources.push(entry.stat_energy_from);
      if (entry.stat_energy_to) allSources.push(entry.stat_energy_to);
    });
    this._excludeList = allSources.filter(
      (id) =>
        id !== this._source?.stat_energy_from &&
        id !== this._source?.stat_energy_to
    );

    this._open = true;
  }

  public closeDialog() {
    this._open = false;
    return true;
  }

  private _dialogClosed() {
    this._params = undefined;
    this._source = undefined;
    this._error = undefined;
    this._excludeList = undefined;
    fireEvent(this, "dialog-closed", { dialog: this.localName });
  }

  protected render() {
    if (!this._params || !this._source) {
      return nothing;
    }

    const hasConsumed = !!this._source.stat_energy_to;

    const externalToSource =
      this._source.stat_energy_to &&
      isExternalStatistic(this._source.stat_energy_to);

    return html`
      <ha-dialog
        .hass=${this.hass}
        .open=${this._open}
        header-title=${this.hass.localize(
          "ui.panel.config.energy.heating.dialog.header"
        )}
        prevent-scrim-close
        @closed=${this._dialogClosed}
      >
        ${this._error ? html`<p class="error">${this._error}</p>` : nothing}

        <ha-statistic-picker
          .hass=${this.hass}
          .helpMissingEntityUrl=${energyStatisticHelpUrl}
          .includeUnitClass=${energyUnitClasses}
          .value=${this._source.stat_energy_from}
          .label=${this.hass.localize(
            "ui.panel.config.energy.heating.dialog.energy_from_heater"
          )}
          .excludeStatistics=${[
            ...(this._excludeList || []),
            this._source.stat_energy_to,
          ].filter((id): id is string => Boolean(id))}
          @value-changed=${this._statisticFromChanged}
          .helper=${this.hass.localize(
            "ui.panel.config.energy.heating.dialog.energy_from_helper",
            { unit: this._energy_units?.join(", ") || "" }
          )}
          autofocus
        ></ha-statistic-picker>

        <ha-statistic-picker
          .hass=${this.hass}
          .helpMissingEntityUrl=${energyStatisticHelpUrl}
          .includeUnitClass=${energyUnitClasses}
          .value=${this._source.stat_energy_to}
          .label=${this.hass.localize(
            "ui.panel.config.energy.heating.dialog.energy_to_heater"
          )}
          .excludeStatistics=${[
            ...(this._excludeList || []),
            this._source.stat_energy_from,
          ].filter((id): id is string => Boolean(id))}
          @value-changed=${this._statisticToChanged}
          .helper=${this.hass.localize(
            "ui.panel.config.energy.heating.dialog.energy_to_helper",
            { unit: this._energy_units?.join(", ") || "" }
          )}
        ></ha-statistic-picker>

        ${hasConsumed /* Only uses price tracking for consumed sensor */
          ? html`<p>
                ${this.hass.localize(
                  "ui.panel.config.energy.heating.dialog.cost_para"
                )}
              </p>

              <ha-formfield
                .label=${this.hass.localize(
                  "ui.panel.config.energy.heating.dialog.no_cost"
                )}
              >
                <ha-radio
                  value="no-costs"
                  name="costs"
                  .checked=${this._costs === "no-costs"}
                  @change=${this._handleCostTypeChanged}
                ></ha-radio>
              </ha-formfield>
              <ha-formfield
                .label=${this.hass.localize(
                  "ui.panel.config.energy.heating.dialog.cost_stat"
                )}
              >
                <ha-radio
                  value="statistic"
                  name="costs"
                  .checked=${this._costs === "statistic"}
                  @change=${this._handleCostTypeChanged}
                ></ha-radio>
              </ha-formfield>
              ${this._costs === "statistic"
                ? html`<ha-statistic-picker
                    class="price-options"
                    .hass=${this.hass}
                    statistic-types="sum"
                    .value=${this._source.stat_cost}
                    .label=${`${this.hass.localize(
                      "ui.panel.config.energy.heating.dialog.cost_stat_label"
                    )} (${this.hass.config.currency})`}
                    @value-changed=${this._statCostChanged}
                  ></ha-statistic-picker>`
                : nothing}
              <ha-formfield
                .label=${this.hass.localize(
                  "ui.panel.config.energy.heating.dialog.cost_entity"
                )}
              >
                <ha-radio
                  value="entity"
                  name="costs"
                  .checked=${this._costs === "entity"}
                  .disabled=${externalToSource}
                  @change=${this._handleCostTypeChanged}
                ></ha-radio>
              </ha-formfield>
              ${this._costs === "entity"
                ? html`<ha-entity-picker
                    class="price-options"
                    .hass=${this.hass}
                    include-domains='["sensor", "input_number"]'
                    .value=${this._source.entity_energy_price}
                    .label=${this.hass.localize(
                      "ui.panel.config.energy.heating.dialog.cost_entity_label"
                    )}
                    .helper=${html`<ha-markdown
                      .content=${this.hass.localize(
                        "ui.panel.config.energy.heating.dialog.cost_entity_helper",
                        { currency: this.hass.config.currency }
                      )}
                    ></ha-markdown>`}
                    @value-changed=${this._entityCostChanged}
                  ></ha-entity-picker>`
                : nothing}
              <ha-formfield
                .label=${this.hass.localize(
                  "ui.panel.config.energy.heating.dialog.cost_number"
                )}
              >
                <ha-radio
                  value="number"
                  name="costs"
                  .checked=${this._costs === "number"}
                  .disabled=${externalToSource}
                  @change=${this._handleCostTypeChanged}
                ></ha-radio>
              </ha-formfield>
              ${this._costs === "number"
                ? html`<ha-input
                    .label=${this.hass.localize(
                      "ui.panel.config.energy.heating.dialog.cost_number_label"
                    )}
                    class="price-options"
                    step="any"
                    type="number"
                    .value=${this._source.number_energy_price !== null
                      ? String(this._source.number_energy_price)
                      : ""}
                    @change=${this._numberCostChanged}
                  >
                    <span slot="end">${this.hass.config.currency}/kWh</span>
                  </ha-input>`
                : nothing}`
          : nothing}

        <ha-dialog-footer slot="footer">
          <ha-button
            appearance="plain"
            @click=${this.closeDialog}
            slot="secondaryAction"
          >
            ${this.hass.localize("ui.common.cancel")}
          </ha-button>
          <ha-button
            @click=${this._save}
            .disabled=${!this._source.stat_energy_from}
            slot="primaryAction"
          >
            ${this.hass.localize("ui.common.save")}
          </ha-button>
        </ha-dialog-footer>
      </ha-dialog>
    `;
  }

  private _handleCostTypeChanged(ev: CustomEvent) {
    const input = ev.currentTarget as HaRadio;
    this._costs = input.value as any;
  }

  private _numberCostChanged(ev) {
    this._source = {
      ...this._source!,
      number_energy_price: Number(ev.target.value),
      entity_energy_price: null,
      stat_cost: null,
    };
  }

  private _statCostChanged(ev: CustomEvent) {
    this._source = {
      ...this._source!,
      entity_energy_price: null,
      number_energy_price: null,
      stat_cost: ev.detail.value,
    };
  }

  private _entityCostChanged(ev: CustomEvent) {
    this._source = {
      ...this._source!,
      entity_energy_price: ev.detail.value,
      number_energy_price: null,
      stat_cost: null,
    };
  }

  private _statisticFromChanged(ev: ValueChangedEvent<string>) {
    this._source = {
      ...this._source!,
      stat_energy_from: ev.detail.value,
    };
  }

  private _statisticToChanged(ev: ValueChangedEvent<string>) {
    this._source = { ...this._source!, stat_energy_to: ev.detail.value };
    // Reset cost type if switching to external statistic with incompatible cost type
    if (
      ev.detail.value &&
      isExternalStatistic(ev.detail.value) &&
      this._costs !== "statistic"
    ) {
      this._costs = "no-costs";
      this._source = {
        ...this._source!,
        entity_energy_price: null,
        number_energy_price: null,
      };
    }
  }

  private async _save() {
    try {
      if (this._costs === "no-costs") {
        this._source!.entity_energy_price = null;
        this._source!.number_energy_price = null;
        this._source!.stat_cost = null;
      }
      await this._params!.saveCallback(this._source!);
      this.closeDialog();
    } catch (err: any) {
      this._error = err.message;
    }
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      haStyleDialog,
      css`
        ha-statistic-picker {
          display: block;
          margin-bottom: var(--ha-space-4);
        }
        ha-formfield {
          display: block;
        }
        .price-options {
          display: block;
          padding-left: 52px;
          padding-inline-start: 52px;
          padding-inline-end: initial;
          margin-top: -8px;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dialog-energy-heating-settings": DialogEnergyHeatingSettings;
  }
}
