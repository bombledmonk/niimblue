<script lang="ts">
  import { onMount } from "svelte";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { appConfirm } from "$/stores/confirm";
  import { ExportedLabelTemplateSchema, type ExportedLabelTemplate } from "$/types";
  import { HaApi, guessLabelName, haSelectedPrinterId, type HaLibraryEntry } from "$/utils/ha_bridge";
  import { Toasts } from "$/utils/toasts";

  interface Props {
    onRequestLabelTemplate: () => ExportedLabelTemplate;
    onLoadRequested: (label: ExportedLabelTemplate) => void;
    onClose?: () => void;
    hasUnsavedChanges: boolean;
  }

  let { onRequestLabelTemplate, onLoadRequested, onClose, hasUnsavedChanges }: Props = $props();

  let modalRef: AppModal;
  let entries = $state<HaLibraryEntry[]>([]);
  let savedOnly = $state<boolean>(false);
  let busy = $state<string | null>(null);
  let newName = $state<string>("");
  let loading = $state<boolean>(true);

  const refresh = async () => {
    try {
      entries = (await HaApi.list(savedOnly)).entries;
    } catch (e) {
      Toasts.error(e);
    }
    loading = false;
  };

  const lastPrint = (e: HaLibraryEntry) => e.prints.at(-1);

  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

  const run = async (id: string, fn: () => Promise<void>) => {
    busy = id;
    try {
      await fn();
    } catch (e) {
      Toasts.error(e);
    }
    busy = null;
    await refresh();
  };

  const toggleSaved = (e: HaLibraryEntry) => run(e.id, async () => void (await HaApi.save({ saved: !e.saved }, e.id)));

  const reprint = (e: HaLibraryEntry) =>
    run(e.id, async () => {
      await HaApi.print({ entry_id: e.id, copies: 1, device_id: $haSelectedPrinterId });
      Toasts.message("Printed");
    });

  const remove = async (e: HaLibraryEntry) => {
    const answer = await appConfirm({
      title: `Delete "${e.name ?? "untitled"}" and its print history from Home Assistant?`,
      buttons: ["yes", "no"],
    });
    if (answer === "yes") {
      await run(e.id, async () => void (await HaApi.remove(e.id)));
    }
  };

  const load = async (e: HaLibraryEntry) => {
    if (hasUnsavedChanges) {
      const answer = await appConfirm({ title: "Discard unsaved changes and load this label?", buttons: ["yes", "no"] });
      if (answer !== "yes") {
        return;
      }
    }
    busy = e.id;
    try {
      const full = await HaApi.get(e.id);
      if (!full.design) {
        throw new Error("This entry has no editable design");
      }
      onLoadRequested(ExportedLabelTemplateSchema.parse(full.design));
      modalRef.hide();
    } catch (err) {
      Toasts.error(err);
    }
    busy = null;
  };

  const saveCurrent = () =>
    run("new", async () => {
      const design = onRequestLabelTemplate();
      const name = newName.trim() || guessLabelName(design) || null;
      if (name) {
        design.title = name;
      }
      await HaApi.save({ name, saved: true, design });
      newName = "";
      Toasts.message("Saved to Home Assistant");
    });

  onMount(refresh);
</script>

<AppModal title="Home Assistant label library" {onClose} bind:this={modalRef} size="lg">
  <div class="mb-2 d-flex align-items-center gap-2">
    <div class="btn-group btn-group-sm">
      <button
        class="btn {savedOnly ? 'btn-outline-secondary' : 'btn-secondary'}"
        onclick={() => {
          savedOnly = false;
          refresh();
        }}>
        <MdIcon icon="history" /> All
      </button>
      <button
        class="btn {savedOnly ? 'btn-secondary' : 'btn-outline-secondary'}"
        onclick={() => {
          savedOnly = true;
          refresh();
        }}>
        <MdIcon icon="star" /> Saved
      </button>
    </div>
    <button class="btn btn-sm btn-outline-secondary ms-auto" title="Refresh" onclick={refresh}>
      <MdIcon icon="refresh" />
    </button>
  </div>

  {#if loading}
    <div class="text-secondary">Loading…</div>
  {:else if entries.length === 0}
    <div class="text-secondary">
      {savedOnly ? "No saved labels yet." : "Nothing printed or saved yet. Labels you print appear here."}
    </div>
  {:else}
    <div class="list-group library">
      {#each entries as e (e.id)}
        {@const last = lastPrint(e)}
        <div class="list-group-item d-flex align-items-center gap-2">
          <div class="thumb">
            {#if e.png}<img src={e.png} alt="" />{/if}
          </div>
          <div class="flex-grow-1 text-truncate">
            <div class="text-truncate">{e.name ?? "(untitled)"}</div>
            <div class="small text-secondary">
              {#if last}
                {fmtDate(last.at)} · {e.prints.length} print{e.prints.length === 1 ? "" : "s"}
                {#if !last.ok}<span class="text-danger" title={last.error ?? ""}> · failed</span>{/if}
              {:else}
                saved {fmtDate(e.created)}
              {/if}
            </div>
          </div>
          <div class="btn-group btn-group-sm flex-shrink-0">
            <button
              class="btn btn-outline-secondary"
              title={e.saved ? "Unstar" : "Star (keep as saved design)"}
              disabled={busy !== null}
              onclick={() => toggleSaved(e)}>
              <MdIcon icon={e.saved ? "star" : "star_border"} />
            </button>
            <button class="btn btn-outline-secondary" title="Open in editor" disabled={busy !== null} onclick={() => load(e)}>
              <MdIcon icon="folder_open" />
            </button>
            <button
              class="btn btn-outline-secondary"
              title="Reprint exactly as printed"
              disabled={busy !== null || !e.png}
              onclick={() => reprint(e)}>
              <MdIcon icon="print" />
            </button>
            <button class="btn btn-outline-danger" title="Delete" disabled={busy !== null} onclick={() => remove(e)}>
              <MdIcon icon="delete" />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#snippet footer()}
    <div class="input-group input-group-sm">
      <input class="form-control" type="text" placeholder="Name (optional)" bind:value={newName} />
      <button class="btn btn-primary" disabled={busy !== null} onclick={saveCurrent}>
        <MdIcon icon="star" /> Save current design
      </button>
    </div>
  {/snippet}
</AppModal>

<style>
  .library {
    max-height: 55vh;
    overflow-y: auto;
  }
  .thumb {
    width: 96px;
    flex-shrink: 0;
    text-align: center;
  }
  .thumb img {
    max-width: 96px;
    max-height: 40px;
    background: #fff;
    image-rendering: pixelated;
  }
</style>
