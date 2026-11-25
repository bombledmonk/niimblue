<script lang="ts">
  import { onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { haPrinters, haSelectedPrinterId, startHaPrinterSync } from "$/utils/ha_bridge";

  const selected = $derived($haPrinters.find((p) => p.deviceId === $haSelectedPrinterId));

  onMount(startHaPrinterSync);
</script>

<div class="ha-status d-flex flex-column gap-1">
  {#if $haPrinters.length === 0}
    <div class="text-warning small">
      <MdIcon icon="warning" /> No NIIMBOT printer found in Home Assistant.
    </div>
  {:else}
    {#if $haPrinters.length > 1}
      <select class="form-select form-select-sm" bind:value={$haSelectedPrinterId}>
        {#each $haPrinters as p (p.deviceId)}
          <option value={p.deviceId}>{p.name}</option>
        {/each}
      </select>
    {/if}

    {#if selected}
      <div class="small">
        <MdIcon icon="home" />
        <strong>{selected.name}</strong>
        {#if selected.model}<span class="text-secondary">({selected.model})</span>{/if}
      </div>
      <div class="small text-secondary d-flex flex-wrap gap-2">
        {#if selected.labelsRemaining !== undefined}
          <span title="Labels remaining on the roll">
            <MdIcon icon="label" />
            {selected.labelsRemaining}{selected.labelsTotal ? ` / ${selected.labelsTotal}` : ""}
          </span>
        {/if}
        {#if selected.battery !== undefined}
          <span title="Battery"><MdIcon icon="battery_full" /> {selected.battery}%</span>
        {/if}
        {#if selected.labelInfo}<span title="Loaded labels">{selected.labelInfo}</span>{/if}
      </div>
    {/if}
  {/if}
</div>
