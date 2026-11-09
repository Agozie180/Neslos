use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let dir = Path::new(args.get(1).context("image directory required")?);
    let vm: dstack_types::VmConfig = serde_json::from_str(&fs::read_to_string(args.get(2).context("vm config path required")?)?)?;
    let meta: Value = serde_json::from_str(&fs::read_to_string(dir.join("metadata.json"))?)?;
    let firmware = dir.join(meta["bios"].as_str().context("bios")?);
    let kernel = dir.join(meta["kernel"].as_str().context("kernel")?);
    let initrd = dir.join(meta["initrd"].as_str().context("initrd")?);
    let measured_cmdline = dstack_mr::tdx::measured_kernel_cmdline(meta["cmdline"].as_str().context("cmdline")?);
    let machine = dstack_mr::Machine {
        cpu_count: vm.cpu_count, memory_size: vm.memory_size,
        firmware: firmware.to_str().unwrap(), kernel: kernel.to_str().unwrap(), initrd: initrd.to_str().unwrap(),
        kernel_cmdline: &measured_cmdline,
        two_pass_add_pages: vm.qemu_single_pass_add_pages, normalized_setup_header: meta["kernel_header_normalized"].as_bool().unwrap_or(false),
        pic: vm.pic, qemu_version: vm.qemu_version.clone(), smm: false, pci_hole64_size: if vm.pci_hole64_size == 0 { None } else { Some(vm.pci_hole64_size) },
        hugepages: vm.hugepages, numa_nodes: &vm.numa_nodes, num_gpus: vm.num_gpus, num_nvswitches: vm.num_nvswitches, num_nics: vm.num_nics,
        num_verity_volumes: vm.num_verity_volumes, extra_root_devices: &vm.extra_root_devices, swtpm: vm.swtpm, hotplug_off: vm.hotplug_off,
        root_verity: true, host_share_mode: vm.host_share_mode.clone(), ovmf_variant: serde_json::from_value(meta["ovmf_variant"].clone())?,
    };
    let measured = machine.measure_with_logs()?;
    let image_hash = dstack_mr::tdx::tdx_measurement_hash_for_image_dir(dir)?;
    println!("{}", serde_json::to_string_pretty(&json!({
        "calculatorSource": "d7e15dc9020101bb37d93ea9eec5f1f4fefe93e7", "osMetadata": meta,
        "plannedShape": vm,
        "imageMeasurementHash": hex::encode(image_hash), "boot": measured.measurements,
        "eventDigests": measured.rtmr_logs.iter().map(|events| events.iter().map(hex::encode).collect::<Vec<_>>()).collect::<Vec<_>>()
    }))?);
    Ok(())
}
