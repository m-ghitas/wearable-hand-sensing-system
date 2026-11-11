# Medical Hand Assist Glove

![Medical Hand Assist Glove - Current Prototype](media/glove-prototype.jpg)

This is an ongoing personal R&D project aimed at developing a wearable glove to monitor finger movement and contact-force sensing for hand rehabilitation.

The first prototype uses flex sensors, an ESP32-C3, and a real-time 3D hand visualization. I'm currently working on integrating and testing the force sensors and improving the mechanical design.

I'll keep updating this repository as the project develops.

## 1. Introduction

This project started from a request by physiotherapy professionals who were looking for a way to obtain measurable feedback on hand movement during rehabilitation, particularly for patients recovering from stroke or other neurological conditions.

The idea is to develop a wearable glove that can monitor how well a patient can bend and extend their fingers, and eventually assess their ability to apply force while holding an object.

The current prototype focuses on finger-motion tracking and real-time 3D visualization. Contact-force sensing is being integrated as the next development step.

The longer-term goal is to collect consistent measurements that can help physiotherapists compare hand function between treatment sessions.

## 2. From Clinical Needs to Engineering Requirements

Before selecting sensors or designing the electronics, I first translated the physiotherapists' needs into quantities that the system could measure.

The two main questions were:
- Can the patient move and control individual fingers?
- Can the patient apply force while grasping an object?

| Clinical need | Quantity to be measurement | Proposed approach |
|---|---|---|
| Assess finger bending and extension | Relative finger flexion | Five flex sensors, one per finger |
| Observe individual finger control | Independent finger response | Five sensor channels and 3D visualization |
| Assess interaction with a held object | Contact-force response | Three mechanically installed force sensors; electrical testing pending |
| Monitor rehabilitation progress | Repeatable measurements across sessions | Planned after sensor characterization and data logging |

For the first prototype, I focused on demonstrating finger-motion sensing and the integration of the wearable system. Reliable force measurement and longitudinal progress tracking are objectives for the next development stages.
